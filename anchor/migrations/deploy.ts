import * as anchor from "@coral-xyz/anchor";

async function main() {
  // Migrations are run through anchor deploy
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);