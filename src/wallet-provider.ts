import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { IWalletProvider, WalletAddress, Asset, Owner, TransactionVerificationStatus, IExternalSigner, Address } from "./types";
import { SquadsFactory, ISquadsWalletConfig } from "./squads-factory";
import { readFileSync } from "fs";

class RealExternalSigner implements IExternalSigner {
    private readonly keypair: Keypair;

    constructor(ownerKeypair: Keypair) {
        this.keypair = ownerKeypair;
    }

    async sign(transaction: Buffer): Promise<string> {
        const tx = Transaction.from(transaction);
        tx.partialSign(this.keypair);
        const signature = tx.signatures.find((sig) => sig.publicKey.equals(this.keypair.publicKey))?.signature;
        if (!signature) throw new Error("Failed to sign transaction");
        return bs58.encode(signature);
    }
}

export class SquadsWalletProvider implements IWalletProvider {
    private externalSigner: IExternalSigner | null = null;
    private ownerKeypair: Keypair | null = null;
    private connection = new Connection("https://api.devnet.solana.com", "confirmed");

    constructor() { }

    async createWallet(owners?: Owner[]): Promise<WalletAddress> {
        this.ownerKeypair = Keypair.generate();
        const memberPubkeys = owners && owners.length > 0
            ? owners.map((owner) => new PublicKey(owner.address))
            : [this.ownerKeypair.publicKey];

        const squadsFactory = await SquadsFactory.getInstance({
            members: memberPubkeys,
            threshold: 1,
        });

        const predictedAddress = await squadsFactory.predictAddress();
        const relayer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync("./relayer.json", "utf8"))));
        const relayerBalance = await this.connection.getBalance(relayer.publicKey);
        console.log(`Relayer balance before deploy: ${relayerBalance / 1e9} SOL`);
        if (relayerBalance < 0.05 * 1e9) {
            throw new Error("Relayer needs at least 0.05 SOL for wallet creation");
        }

        const txHash = await squadsFactory.deployWallet(relayer);
        console.log(`Wallet deployed with txHash: ${txHash}`);

        const walletAddress: WalletAddress = {
            id: `solana-${predictedAddress}`,
            address: predictedAddress,
            owners: owners && owners.length > 0
                ? owners
                : [{ id: "owner1", address: this.ownerKeypair.publicKey.toBase58() }],
            data: {
                createKey: squadsFactory["config"].createKey,
                createKeySecret: squadsFactory["config"].createKeySecret,
                threshold: 1,
                owners: memberPubkeys.map(pubkey => pubkey.toBase58()),
            },
        };

        this.externalSigner = new RealExternalSigner(this.ownerKeypair);
        return walletAddress;
    }

    async getAddress(walletAddress: WalletAddress): Promise<string> {
        const squadsConfig: ISquadsWalletConfig = {
            address: walletAddress.address,
            members: walletAddress.owners?.map((owner) => new PublicKey(owner.address)),
            ...walletAddress.data,
        };
        const squadsFactory = await SquadsFactory.getInstance(squadsConfig);
        return squadsFactory.predictAddress();
    }

    async getBalance(walletAddress: WalletAddress, asset: Asset): Promise<string> {
        const squadsConfig: ISquadsWalletConfig = {
            address: walletAddress.address,
            members: walletAddress.owners?.map((owner) => new PublicKey(owner.address)),
            ...walletAddress.data,
        };
        const squadsFactory = await SquadsFactory.getInstance(squadsConfig);
        return squadsFactory.getBalance(asset.address);
    }

    async transferToken(
        walletAddress: WalletAddress,
        tokenAddress: Address,
        recipientAddress: Address,
        amount: bigint
    ): Promise<string> {
        try {
            console.log(`Transferring ${amount} of ${tokenAddress} to ${recipientAddress}`);

            const squadsConfig: ISquadsWalletConfig = {
                address: walletAddress.address,
                members: walletAddress.owners?.map((owner) => new PublicKey(owner.address)),
                ...walletAddress.data,
            };
            const squadsFactory = await SquadsFactory.getInstance(squadsConfig);

            const { setupTransaction, transactionIndex } = await squadsFactory.prepareSetupTransaction(
                tokenAddress,
                recipientAddress,
                amount
            );

            if (!this.externalSigner) {
                throw new Error("External signer not initialized");
            }

            let serializedSetupTx = setupTransaction.serialize({ requireAllSignatures: false, verifySignatures: false });
            const signature = await this.externalSigner.sign(Buffer.from(serializedSetupTx));
            setupTransaction.addSignature(
                new PublicKey(walletAddress.owners![0].address),
                Buffer.from(bs58.decode(signature))
            );

            const setupTxHash = await squadsFactory.executeTransaction(setupTransaction.serialize());
            console.log("Setup transaction hash:", setupTxHash);

            let status = await squadsFactory.checkTransactionStatus(setupTxHash);
            let attempts = 0;
            const maxAttempts = 15;
            while (status !== TransactionVerificationStatus.Confirmed && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                status = await squadsFactory.checkTransactionStatus(setupTxHash);
                attempts++;
            }

            if (status !== TransactionVerificationStatus.Confirmed) {
                throw new Error(`Setup transaction ${setupTxHash} failed to confirm after ${maxAttempts} attempts`);
            }

            const executeTransaction = await squadsFactory.prepareExecuteTransaction(transactionIndex);
            const executeTxHash = await squadsFactory.executeTransaction(executeTransaction.serialize());
            console.log("Execute transaction hash:", executeTxHash);
            return executeTxHash;
        } catch (error) {
            console.error("Transfer token error:", error);
            if (error instanceof Error && "logs" in error) {
                console.error("Transaction logs:", (error as any).logs);
            }
            throw error;
        }
    }

    async verifyTokenTransfer(
        walletAddress: WalletAddress,
        tokenAddress: Address,
        recipientAddress: Address,
        amount: bigint,
        transactionHash: string
    ): Promise<TransactionVerificationStatus> {
        const squadsConfig: ISquadsWalletConfig = {
            address: walletAddress.address,
            members: walletAddress.owners?.map((owner) => new PublicKey(owner.address)),
            ...walletAddress.data,
        };
        const squadsFactory = await SquadsFactory.getInstance(squadsConfig);
        return squadsFactory.checkTransactionStatus(transactionHash);
    }

    getOwnerKeypair(): Keypair | null {
        return this.ownerKeypair;
    }
}