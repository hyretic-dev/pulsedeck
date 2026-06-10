import { streamText } from "ai";
import { createMistral } from "@ai-sdk/mistral";
const mistral = createMistral({ apiKey: "dummy" });
const result = streamText({
  model: mistral("mistral-small-latest"),
  prompt: "Hello",
});

let props = new Set();
let obj = result;
while (obj) {
  Object.getOwnPropertyNames(obj).forEach(p => props.add(p));
  obj = Object.getPrototypeOf(obj);
}
console.log("All methods:", Array.from(props));
