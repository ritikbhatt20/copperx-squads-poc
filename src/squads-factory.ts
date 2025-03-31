import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionMessage,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { TransactionVerificationStatus } from "./types";
import { readFileSync } from "fs";

const { Permission, Permissions } = multisig.types;

export interface ISquadsWalletConfig {
    address?: string;
    members?: PublicKey[];
    threshold?: number;
    createKey?: string;
    createKeySecret?: string;
}

export class SquadsFactory {
    private readonly connection: Connection;
    private readonly config: ISquadsWalletConfig;
    private readonly createKeypair: Keypair;
    private readonly multisigPda: PublicKey;
    private readonly vaultPda: PublicKey;

    constructor(config: ISquadsWalletConfig) {
        this.connection = new Connection("https://api.devnet.solana.com", "confirmed");
        this.config = config;

        this.createKeypair = config.createKeySecret
            ? Keypair.fromSecretKey(Buffer.from(config.createKeySecret, "base64"))
            : Keypair.generate();

        if (!config.createKey) {
            this.config.createKey = this.createKeypair.publicKey.toBase58();
            this.config.createKeySecret = Buffer.from(this.createKeypair.secretKey).toString("base64");
        }

        const [multisigPda] = multisig.getMultisigPda({ createKey: this.createKeypair.publicKey });
        this.multisigPda = multisigPda;

        const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
        this.vaultPda = vaultPda;
    }

    static async getInstance(config: Partial<ISquadsWalletConfig>): Promise<SquadsFactory> {
        if (config.address) {
            return new SquadsFactory(config as ISquadsWalletConfig);
        }
        return new SquadsFactory(config as ISquadsWalletConfig);
    }

    async predictAddress(): Promise<string> {
        return this.vaultPda.toBase58();
    }

    async deployWallet(relayer: Keypair): Promise<string> {
        const relayerBalance = await this.connection.getBalance(relayer.publicKey);
        console.log(`Relayer balance: ${relayerBalance / 1e9} SOL`);
        if (relayerBalance < 0.05 * 1e9) {
            throw new Error("Relayer needs at least 0.05 SOL for fees and rent");
        }

        const programConfigPda = multisig.getProgramConfigPda({})[0];
        const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
            this.connection,
            programConfigPda
        );
        const configTreasury = programConfig.treasury;

        const ix = await multisig.instructions.multisigCreateV2({
            createKey: this.createKeypair.publicKey,
            creator: relayer.publicKey,
            multisigPda: this.multisigPda,
            configAuthority: null,
            timeLock: 0,
            members: [
                ...(this.config.members?.map((member) => ({
                    key: member,
                    permissions: Permissions.all(),
                })) || []),
                {
                    key: relayer.publicKey,
                    permissions: Permissions.fromPermissions([Permission.Execute]),
                },
            ],
            threshold: this.config.threshold || 1,
            treasury: configTreasury,
            rentCollector: null,
        });

        const tx = new Transaction();
        tx.add(ix);
        tx.feePayer = relayer.publicKey;
        tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

        tx.partialSign(relayer);
        tx.partialSign(this.createKeypair);

        const txHash = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
        await this.connection.confirmTransaction(txHash);
        return txHash;
    }

    async prepareSetupTransaction(
        tokenAddress: string,
        recipientAddress: string,
        amount: bigint
    ): Promise<{ setupTransaction: Transaction; transactionIndex: bigint }> {
        const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
            this.connection,
            this.multisigPda
        );
        const currentTransactionIndex = Number(multisigInfo.transactionIndex);
        const transactionIndex = BigInt(currentTransactionIndex + 1);

        const relayer = this.getRelayerKeypair();
        let transferInstruction;

        if (tokenAddress === "SOL") {
            transferInstruction = SystemProgram.transfer({
                fromPubkey: this.vaultPda,
                toPubkey: new PublicKey(recipientAddress),
                lamports: Number(amount),
            });
        } else {
            const tokenPubkey = new PublicKey(tokenAddress);
            const sourceTokenAccount = getAssociatedTokenAddressSync(tokenPubkey, this.vaultPda, true);
            const destinationTokenAccount = getAssociatedTokenAddressSync(
                tokenPubkey,
                new PublicKey(recipientAddress),
                true
            );
            transferInstruction = createTransferInstruction(
                sourceTokenAccount,
                destinationTokenAccount,
                this.vaultPda,
                Number(amount)
            );
        }

        const transferMessage = new TransactionMessage({
            payerKey: relayer.publicKey,
            recentBlockhash: (await this.connection.getLatestBlockhash()).blockhash,
            instructions: [transferInstruction],
        });

        const ixTransfer = await multisig.instructions.vaultTransactionCreate({
            multisigPda: this.multisigPda,
            transactionIndex,
            creator: this.config.members![0],
            rentPayer: relayer.publicKey,
            vaultIndex: 0,
            ephemeralSigners: 0,
            transactionMessage: transferMessage,
            memo: `Transfer ${amount} of ${tokenAddress} to ${recipientAddress}`,
        });

        const ixProposal = await multisig.instructions.proposalCreate({
            multisigPda: this.multisigPda,
            transactionIndex,
            creator: this.config.members![0],
        });

        const ixApprove = await multisig.instructions.proposalApprove({
            multisigPda: this.multisigPda,
            transactionIndex,
            member: this.config.members![0],
        });

        const setupTransaction = new Transaction();
        setupTransaction.add(ixTransfer, ixProposal, ixApprove);
        setupTransaction.feePayer = relayer.publicKey;
        setupTransaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
        setupTransaction.partialSign(relayer);

        return { setupTransaction, transactionIndex };
    }

    async prepareExecuteTransaction(transactionIndex: bigint): Promise<Transaction> {
        const relayer = this.getRelayerKeypair();

        const ixExecute = await multisig.instructions.vaultTransactionExecute({
            connection: this.connection,
            multisigPda: this.multisigPda,
            transactionIndex,
            member: relayer.publicKey,
        });

        const executeTransaction = new Transaction();
        executeTransaction.add(ixExecute.instruction);
        executeTransaction.feePayer = relayer.publicKey;
        executeTransaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
        executeTransaction.partialSign(relayer);

        return executeTransaction;
    }

    async executeTransaction(signedTxBuffer: Buffer): Promise<string> {
        try {
            const txHash = await this.connection.sendRawTransaction(signedTxBuffer, { skipPreflight: false });
            await this.connection.confirmTransaction(txHash);
            return txHash;
        } catch (error) {
            console.error("Execute transaction failed:", error);
            if (error instanceof Error && "logs" in error) {
                console.error("Transaction logs:", (error as any).logs);
            }
            throw error;
        }
    }

    async getBalance(tokenAddress: string): Promise<string> {
        if (tokenAddress === "SOL") {
            const balance = await this.connection.getBalance(this.vaultPda);
            return balance.toString();
        } else {
            const tokenPubkey = new PublicKey(tokenAddress);
            const associatedTokenAddress = getAssociatedTokenAddressSync(tokenPubkey, this.vaultPda, true);
            try {
                const accountInfo = await this.connection.getTokenAccountBalance(associatedTokenAddress);
                return accountInfo.value.amount;
            } catch {
                return "0";
            }
        }
    }

    async checkTransactionStatus(txHash: string): Promise<TransactionVerificationStatus> {
        const tx = await this.connection.getTransaction(txHash, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
        });
        if (!tx) return TransactionVerificationStatus.Pending;
        if (tx.meta?.err) return TransactionVerificationStatus.Failed;
        return TransactionVerificationStatus.Confirmed;
    }

    private getRelayerKeypair(): Keypair {
        const secretKey = JSON.parse(readFileSync("./relayer.json", "utf8"));
        return Keypair.fromSecretKey(new Uint8Array(secretKey));
    }
}