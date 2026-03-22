import { decay } from "./service.js";

const rate = parseFloat(process.argv[2] ?? "0.05");

console.log(`Running confidence decay with rate: ${rate}`);
const result = await decay(rate);
console.log("Decay complete:", result);
