import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { SquadsWalletProvider } from "./wallet-provider";
import { Owner, Asset } from "./types";
import { readFileSync } from "fs";

async function runPoC() {
    const walletProvider = new SquadsWalletProvider();
    const relayer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync("./relayer.json", "utf8"))));

    const connection = walletProvider["connection"];
    const relayerBalance = await connection.getBalance(relayer.publicKey);
    console.log(`Relayer balance: ${relayerBalance / 1e9} SOL`);
    // Ensure relayer has enough SOL for fees and rent
    if (relayerBalance < 0.05 * 1e9) {
        console.error("Please fund the relayer with at least 0.05 SOL");
        return;
    }

    console.log("Creating wallet...");
    const wallet = await walletProvider.createWallet();
    console.log("Wallet created:", wallet.address);

    const txVault = new Transaction();
    txVault.add(
        SystemProgram.transfer({
            fromPubkey: relayer.publicKey,
            toPubkey: new PublicKey(wallet.address),
            lamports: 10000000, // 0.01 SOL
        })
    );
    txVault.feePayer = relayer.publicKey;
    txVault.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    txVault.sign(relayer);
    const fundTxHash = await connection.sendRawTransaction(txVault.serialize(), { skipPreflight: false });
    await connection.confirmTransaction(fundTxHash);
    console.log("Vault funded with txHash:", fundTxHash);

    const creator = walletProvider.getOwnerKeypair()!;
    const txCreator = new Transaction();
    txCreator.add(
        SystemProgram.transfer({
            fromPubkey: relayer.publicKey,
            toPubkey: creator.publicKey,
            lamports: 10000000, // 0.01 SOL to cover rent for VaultTransaction and Proposal
        })
    );
    txCreator.feePayer = relayer.publicKey;
    txCreator.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    txCreator.sign(relayer);
    const creatorFundTxHash = await connection.sendRawTransaction(txCreator.serialize(), { skipPreflight: false });
    await connection.confirmTransaction(creatorFundTxHash);
    console.log("Creator funded with txHash:", creatorFundTxHash);

    const asset: Asset = {
        id: "sol",
        address: "SOL",
        symbol: "SOL",
        decimals: 9,
        name: "Solana",
    };

    const balance = await walletProvider.getBalance(wallet, asset);
    console.log("Initial vault balance:", balance);

    const recipient = Keypair.generate().publicKey.toBase58();
    const amount = BigInt(1000000); // 0.001 SOL
    console.log(`Transferring ${amount} SOL to ${recipient}...`);
    const txHash = await walletProvider.transferToken(wallet, asset.address, recipient, amount);
    console.log("Transfer txHash:", txHash);

    const status = await walletProvider.verifyTokenTransfer(wallet, asset.address, recipient, amount, txHash);
    console.log("Transaction status:", status);
}

runPoC().catch((error) => {
    console.error("Error:", error);
    if (error.logs) console.error("Logs:", error.logs);
});