#!/usr/bin/env node
import { generatorHandler } from "@prisma/generator-helper";
import { generate } from "./generate";

// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access
const version = require("../package.json").version as string;
const disabled = process.env.DISABLE_PRISMA_GRAPHER === "true";

generatorHandler({
  onManifest: () => ({
    defaultOutput: disabled ? "N/A" : "./ERD.svg",
    prettyName: disabled ? "No ERD" : "Entity-relationship-diagram",
    requiresEngines: ["queryEngine"],
    version,
  }),
  onGenerate: generate,
});
