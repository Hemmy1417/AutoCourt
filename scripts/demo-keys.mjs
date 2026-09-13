/**
 * Demo-only wallet keys, shared by scripts/seed-demo.mjs and
 * scripts/dev-signer.mjs.
 *
 * They live in their own module because importing them must NOT run a
 * seed: a script that both exports constants and executes on import will
 * fire its whole body the moment anything imports it.
 *
 * These are the well-known Hardhat/Anvil development accounts. They hold
 * nothing, they are public knowledge, and nothing but local demos ever
 * uses them.
 */
export const SELLER_PK =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const BUYER_PK =
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
