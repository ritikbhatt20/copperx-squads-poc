# Copperx Squads Protocol PoC

This repository contains a proof-of-concept (PoC) integrating the Squads Protocol (a multisig wallet solution on Solana) with a custom `IWalletProvider` interface, designed to simulate Copperx's wallet management system. It includes an external signer (`MockExternalSigner`) to mimic Circle's signing mechanism.

## Overview

The PoC demonstrates:

- Creation of a multisig wallet using Squads on Solana Devnet.
- Funding of the wallet vault and creator accounts.
- Transfer of 0.001 SOL using a two-step process (setup and execution).
- External signer integration for transaction approval, simulating Circle's role.
- Clean logging of essential steps and transaction hashes.

Code is structured to align with potential requirements for secure, programmatic wallet management, with extensibility for Circle's signing infrastructure.

## Prerequisites

- **Node.js**: Version 16.x or higher.
- **npm**: For package management.
- **Solana Devnet Access**: The PoC runs on Solana Devnet.
- **Relayer Keypair**: A funded Solana keypair stored in `relayer.json` (minimum 0.05 SOL).

## Setup

### Clone the Repository:

```bash
git clone https://github.com/yourusername/copperx-squads-poc.git
cd copperx-squads-poc
```

### Install Dependencies:

```bash
npm install
```

### Configure Relayer Keypair:

1. Generate a Solana keypair using:
   ```bash
   solana-keygen new --outfile relayer.json
   ```
2. Fund the relayer account with at least 0.05 SOL on Devnet:
   ```bash
   solana airdrop 1 <RELAYER_PUBLIC_KEY> --url https://api.devnet.solana.com
   ```
3. Place the `relayer.json` file in the project root.

### Verify Environment:

- Ensure Node.js is installed:
  ```bash
  node -v
  ```
- Ensure the relayer has sufficient funds:
  ```bash
  solana balance <RELAYER_PUBLIC_KEY> --url https://api.devnet.solana.com
  ```

## Usage

Run the PoC with:

```bash
npm start
```

### Expected Output

```plaintext
Relayer balance: 1.79278916 SOL
Creating wallet...
Relayer balance before deploy: 1.79278916 SOL
Wallet deployed with txHash: <TX_HASH>
Wallet created: <VAULT_ADDRESS>
Vault funded with txHash: <FUND_TX_HASH>
Creator funded with txHash: <CREATOR_FUND_TX_HASH>
Initial vault balance: 10000000
Transferring 1000000 SOL to <RECIPIENT_ADDRESS>...
Setup transaction hash: <SETUP_TX_HASH>
Execute transaction hash: <EXECUTE_TX_HASH>
Transfer txHash: <EXECUTE_TX_HASH>
Transaction status: Confirmed
```

### Steps:

1. Creates a multisig wallet with a creator and relayer as members.
2. Funds the vault (0.01 SOL) and creator (0.01 SOL).
3. Transfers 0.001 SOL to a random recipient.
4. Verifies the transaction status.

## Project Structure

- **`src/types.ts`**: Defines interfaces (`IWalletProvider`, `IExternalSigner`, etc.) for wallet management and external signing.
- **`src/squads-factory.ts`**: Core Squads protocol logic for wallet creation, transaction setup, and execution.
- **`src/wallet-provider.ts`**: Implements `IWalletProvider` with Squads integration and an external signer (`MockExternalSigner`).
- **`src/main.ts`**: Runs the PoC, orchestrating wallet creation, funding, and transfer.

## Key Features

- **Multisig Wallet**: Uses Squads for secure, multi-party wallet management.
- **External Signer**: `MockExternalSigner` simulates Circle’s signing process, extensible for real Circle API integration.
- **Two-Step Transfer**: Separates proposal creation/approval (setup) from execution for clarity and security.
- **Clean Output**: Logs only essential information (balances, hashes, status).

### Example Circle Integration

Modify `RealExternalSigner` to:

```typescript
class CircleExternalSigner implements IExternalSigner {
  async sign(transaction: Buffer): Promise<string> {
    const response = await fetch("https://circle-api/sign", {
      method: "POST",
      body: transaction.toString("base64"),
    });
    const { signature } = await response.json();
    return signature;
  }
}
```

## Troubleshooting

- **Insufficient Funds**: Ensure the relayer has at least 0.05 SOL and the creator/vault are funded (0.01 SOL each).
- **Transaction Failures**: Check Solana Devnet explorer (e.g., `https://explorer.solana.com/tx/<TX_HASH>?cluster=devnet`) for detailed logs.
- **External Signer Errors**: Verify the `externalSigner` is initialized correctly in `createWallet`.
