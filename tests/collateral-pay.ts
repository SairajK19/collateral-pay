import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { CollateralPay } from "../target/types/collateral_pay";
import * as serumComm from "@project-serum/common";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  createAssociatedTokenAccount,
  createMint,
  findAssociatedTokenAddress,
  transferSOL,
} from "./utils";
import { mintTo, transfer } from "@project-serum/serum/lib/token-instructions";
import * as serum from "@project-serum/serum";
import {
  Token,
  TOKEN_PROGRAM_ID as TPID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("collateral-pay", async () => {
  anchor.setProvider(anchor.Provider.env());

  const program = anchor.workspace.CollateralPay as Program<CollateralPay>;
  const buyer = new anchor.web3.Keypair();
  const seller = new anchor.web3.Keypair();
  const [vault, nonce] = await anchor.web3.PublicKey.findProgramAddress(
    [buyer.publicKey.toBuffer()],
    program.programId
  );
  console.log(nonce)
  let paymentChannel: Keypair = new anchor.web3.Keypair();
  let USDC_MINT: PublicKey;
  let buyer_usdc_associated_acc: PublicKey;
  let seller_usdc_associated_acc: PublicKey;

  const tx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.transfer({
      fromPubkey: anchor.getProvider().wallet.publicKey,
      toPubkey: buyer.publicKey,
      lamports: anchor.web3.LAMPORTS_PER_SOL * 100,
    }),
    anchor.web3.SystemProgram.transfer({
      fromPubkey: anchor.getProvider().wallet.publicKey,
      toPubkey: seller.publicKey,
      lamports: anchor.web3.LAMPORTS_PER_SOL * 100,
    })
  );

  it("Creates a payment channel!", async () => {
    await anchor.getProvider().send(tx);

    USDC_MINT = await createMint(
      anchor.getProvider(),
      anchor.getProvider().wallet.publicKey
    );

    seller_usdc_associated_acc = await createAssociatedTokenAccount(
      anchor.getProvider(),
      USDC_MINT,
      seller.publicKey
    );

    await program.rpc.createChannel(
      new anchor.BN(5),
      seller.publicKey,
      seller_usdc_associated_acc,
      vault,
      nonce,
      {
        accounts: {
          buyer: buyer.publicKey,
          paymentChannel: paymentChannel.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [buyer, paymentChannel],
      }
    );

    console.log(
      await program.account.paymentChannel.fetch(paymentChannel.publicKey)
    );
  });

  it("It Locks Sol into the vault!", async () => {
    await program.rpc.lockSol(new anchor.BN(5), {
      accounts: {
        buyer: buyer.publicKey,
        vaultPda: vault,
        paymentChannel: paymentChannel.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [buyer],
    });

    console.log(
      (await anchor.getProvider().connection.getBalance(vault)) /
        anchor.web3.LAMPORTS_PER_SOL
    );
  });

  it("Pays half of the amount!", async () => {
    buyer_usdc_associated_acc = await createAssociatedTokenAccount(
      anchor.getProvider(),
      USDC_MINT,
      buyer.publicKey
    );

    const tx = new anchor.web3.Transaction().add(
      serum.TokenInstructions.mintTo({
        mint: USDC_MINT,
        amount: 100,
        mintAuthority: anchor.getProvider().wallet.publicKey,
        destination: buyer_usdc_associated_acc,
      })
    );

    await anchor.getProvider().send(tx);

    await program.rpc.payAmount(new anchor.BN(2), {
      accounts: {
        buyer: buyer_usdc_associated_acc,
        seller: seller_usdc_associated_acc,
        authority: buyer.publicKey,
        paymentChannel: paymentChannel.publicKey,
        tokenProgram: TPID,
      },
      signers: [buyer],
    });

    console.log(
      await serumComm
        .getTokenAccount(anchor.getProvider(), buyer_usdc_associated_acc)
        .then((data) => Number(data.amount))
    );
  });

  it("Pays the remaining half of the amount!", async () => {
    await program.rpc.payAmount(new anchor.BN(3), {
      accounts: {
        buyer: buyer_usdc_associated_acc,
        seller: seller_usdc_associated_acc,
        authority: buyer.publicKey,
        paymentChannel: paymentChannel.publicKey,
        tokenProgram: TPID,
      },
      signers: [buyer],
    });

    console.log(
      await serumComm
        .getTokenAccount(anchor.getProvider(), buyer_usdc_associated_acc)
        .then((data) => Number(data.amount))
    );

    console.log(
      await program.account.paymentChannel.fetch(paymentChannel.publicKey)
    );
  });

  it("Allows withdrawing locked SOL once paid the full amount!", async () => {
    await program.rpc.withdrawLocked({
      accounts: {
        buyer: buyer.publicKey,
        vaultPda: vault,
        paymentChannel: paymentChannel.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [buyer],
    });
  });
});
