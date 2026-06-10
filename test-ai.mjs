import { streamText } from "ai";
import { createMistral } from "@ai-sdk/mistral";
try {
  const mistral = createMistral({ apiKey: "dummy" });
  const result = streamText({
    model: mistral("mistral-small-latest"),
    prompt: "Hello",
  });
  console.log("Keys on result:", Object.keys(result));
} catch (e) {
  console.error(e);
}
