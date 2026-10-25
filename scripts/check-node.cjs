// Runs before `npm run dev`, `dev:all` and `chain`. Written in old-style JavaScript on purpose, so even a
// very old Node can run it and say what is wrong, instead of failing with "Unexpected token import".
var parts = process.versions.node.split(".").map(Number);
if (parts[0] < 22 || (parts[0] === 22 && parts[1] < 13)) {
  console.error("\nPokechain needs Node.js 22.13 or newer; this terminal is on Node " + process.versions.node + ".");
  console.error("With nvm: run `nvm use` in the project folder (it reads .nvmrc), or `nvm alias default 24` once so");
  console.error("every new terminal starts on Node 24. Then run the command again.\n");
  process.exit(1);
}
