#!/usr/bin/env node

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import logger from "./config/logger.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5005;
const provider = process.env.AI_PROVIDER || "groq";

let aiClient; 

if (provider === "gemini") {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  aiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
} else if (provider === "openai") {
  aiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
} else if (provider === "groq") {
  aiClient = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
  });
}

// Basic server setup.
app.use(bodyParser.json());
app.use(bodyParser.text({ type: "text/plain" }));

app.use((req, res, next) => {
  logger.info(`Incoming Request: ${req.method} ${req.url}`);
  next();
});

const saveDir = path.resolve("generated-tests");
if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

// Endpoint to serve the OpenAPI specification.
app.get("/mcp/resources/openapi-spec", (req, res) => {
  try {
    const specFilePath = path.join(process.cwd(), 'openapi.json');
    const specFileContent = fs.readFileSync(specFilePath, 'utf8');
    const specJson = JSON.parse(specFileContent);
    res.json(specJson);
  } catch (err) {
    logger.error("Error reading OpenAPI spec file:", err);
    res.status(500).json({ error: "Could not load OpenAPI spec." });
  }
});

// Endpoint to dynamically list endpoints from the OpenAPI spec.
app.get("/mcp/tools/list-endpoints", async (req, res) => {
  try {
    const specResp = await fetch(`http://localhost:${port}/mcp/resources/openapi-spec`);
    const spec = await specResp.json();

    const endpoints = [];
    for (const path in spec.paths) {
      for (const method in spec.paths[path]) {
        endpoints.push({
          path: path.replace(/{(\w+)}/g, ':$1'), 
          method: method.toUpperCase()
        });
      }
    }
    res.json({ endpoints });

  } catch (err) {
    logger.error("Error parsing OpenAPI spec to list endpoints:", err);
    res.status(500).json({ error: "Could not parse spec to list endpoints." });
  }
});

// Main endpoint for AI test generation.
app.post("/mcp/tools/generate-tests-nlp", async (req, res) => {
  try {
    const endpointsResp = await fetch(`http://localhost:${port}/mcp/tools/list-endpoints`);
    const { endpoints } = await endpointsResp.json();
    if (!endpoints || endpoints.length === 0) return res.status(400).json({ error: "No endpoints found" });

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Transfer-Encoding", "chunked");
    logger.info(`🔹 Starting AI test generation for ${endpoints.length} endpoints...`);
    res.write(JSON.stringify({ step: 1, msg: `Starting AI test generation for ${endpoints.length} endpoints...` }) + "\n");

    const collection = {
      info: { name: `Generated API Test Collection (${provider})`, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      item: [],
    };

    for (const epObj of endpoints) {
      const endpoint = epObj.path;
      const method = epObj.method.toUpperCase();

      logger.info(`🔹 Analyzing ${method} ${endpoint}...`);
      res.write(JSON.stringify({ step: `analyzing-${endpoint}`, msg: `Analyzing ${method} ${endpoint}...` }) + "\n");

      const prompt = `
Your task is to generate a JSON object for an API test case.
You MUST follow the structure of the example provided. Do not add any extra keys.
The JSON object MUST contain ONLY "testCaseName" and "steps" keys at the root level.
---
Method: GET
Endpoint: /products/:id
Response:
{
  "testCaseName": "Retrieve a Single Product",
  "steps": [
    {
      "action": "Send a GET request for a valid product ID.",
      "expectedResult": "The API returns a 200 OK status with the product details."
    },
    {
      "action": "Send a GET request for an invalid product ID.",
      "expectedResult": "The API returns a 404 Not Found status."
    }
  ]
}
---
Now, generate the JSON object for the following API endpoint using the exact same structure:
Input:
Method: ${method}
Endpoint: ${endpoint}
Response:
`;

      let rawResponse = "";
      let nlpTestCase;
      const isOAICompatible = provider === 'openai' || provider === 'groq';

      if (isOAICompatible) {
        const modelName = provider === 'groq' ? "llama-3.1-8b-instant" : "gpt-3.5-turbo";

        const stream = await aiClient.chat.completions.create({
          model: modelName,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          stream: true,
        });

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || "";
          rawResponse += text;
          if (text) {
             res.write(JSON.stringify({ step: `stream-${endpoint}`, partial: text }) + "\n");
          }
        }
        nlpTestCase = JSON.parse(rawResponse);

      } else if (provider === 'gemini') {
      }

      if (!nlpTestCase || !nlpTestCase.steps?.length) {
        logger.warn(`AI response for ${method} ${endpoint} was not in the expected format. Using default test.`);
        nlpTestCase = { testCaseName: `${method} ${endpoint} Default Test`, steps: [{ action: "Verify response status", expectedResult: "200 OK" }] };
      }

      logger.info(`Completed AI test generation for ${endpoint}`);
      
      collection.item.push({
        name: nlpTestCase.testCaseName,
        request: {
          method,
          header: [{ key: "Content-Type", value: "application/json" }],
          url: { raw: `{{BASE_URL}}${endpoint}`, host: ["{{BASE_URL}}"], path: endpoint.replace(/^\//, "").split("/") },
        },
        event: [
          {
            listen: "test",
            script: {
              type: "text/javascript",
              exec: nlpTestCase.steps.map((s, idx) => `pm.test("Step ${idx + 1}: ${s.action}", function() { pm.response.to.have.status(200); }); // Placeholder assertion for: ${s.expectedResult}`),
            },
          },
        ],
      });
    }

    const filePath = path.join(saveDir, `${provider}_combined_collection.json`);
    fs.writeFileSync(filePath, JSON.stringify({ collection }, null, 2));

    logger.info(`All tests generated! Saved to ${filePath}`);
    res.write(JSON.stringify({ step: "done", savedTo: filePath, postmanCollection: collection }) + "\n");
    res.end();

  } catch (err) {
    logger.error(`Error generating tests: ${err.message}`, { stack: err.stack });
    res.write(JSON.stringify({ error: err.message }) + "\n");
    res.end();
  }
});

app.listen(port, () =>
  logger.info(`MCP server running with ${provider.toUpperCase()} at http://localhost:${port}/mcp`)
);