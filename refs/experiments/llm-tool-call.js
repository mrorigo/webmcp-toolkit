
const session = await LanguageModel.create({
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Downloaded ${e.loaded * 100}%`);
    });
  },
});

const response = await session.prompt([
  {
    role: 'system',
    content: 'Available tools: edit_text, write_text, delete_text. Response format: {"tool": "<tool-name>", "arguments": Object }',
  },
  {
    role: 'user',
    content: 'Write a poem'
  }
],
  {
    responseConstraint: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          enum: ["edit_text", "write_text", "delete_text"],
        },
        arguments: {
          type: "object",
        },
      },
      required: ["tool", "arguments"],
    },
  });

console.log(response)
