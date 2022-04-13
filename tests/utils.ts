import * as anchor from "@project-serum/anchor";
import * as serum from "@project-serum/serum";
import * as serumComm from "@project-serum/common";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@project-serum/serum/lib/token-instructions";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

export async function getTokenAccount(provider, addr) {
  return await serumComm.getTokenAccount(provider, addr);
}

export async function createMint(
  provider: anchor.Provider,
  authority?: PublicKey
) {
  if (authority === undefined) {
    authority = provider.wallet.publicKey;
  }

  // Create mint account
  const mint = anchor.web3.Keypair.generate();
  const instructions = [
    anchor.web3.SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      space: 82,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
      programId: TOKEN_PROGRAM_ID,
    }),
    serum.TokenInstructions.initializeMint({
      mint: mint.publicKey,
      decimals: 0,
      mintAuthority: provider.wallet.publicKey,
    }),
  ];

  const tx = new anchor.web3.Transaction().add(...instructions);

  await provider.send(tx, [mint]);

  return mint.publicKey;
}

export async function createAssociatedTokenAccount(
  provider: anchor.Provider,
  mint: PublicKey,
  owner: PublicKey
) {
  const tokenAcc = anchor.web3.Keypair.generate();
  const tx = new anchor.web3.Transaction().add(
    ...[
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(
          165
        ),
        newAccountPubkey: tokenAcc.publicKey,
        programId: TOKEN_PROGRAM_ID,
        space: 165,
      }),
      serum.TokenInstructions.initializeAccount({
        account: tokenAcc.publicKey,
        mint: mint,
        owner, // owner of the mint
      }),
    ]
  );

  await provider.send(tx, [tokenAcc]);

  return tokenAcc.publicKey;
}

export async function transferSOL(
  to: PublicKey,
  from: PublicKey,
  fromWallet: Keypair,
  amount: number
) {
  var tx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports: Number(new anchor.BN(amount)),
    })
  );

  await anchor.getProvider().send(tx, [fromWallet]);
}

export async function findAssociatedTokenAddress(
  walletAddress: PublicKey,
  tokenMintAddress: PublicKey
): Promise<PublicKey> {
  return (
    await PublicKey.findProgramAddress(
      [
        walletAddress.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        tokenMintAddress.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  )[0];
}
