import { graphviz } from "@hpcc-js/wasm";
import { DMMF, GeneratorOptions } from "@prisma/generator-helper";
import { writeFile } from "fs/promises";

// for prisma generators
// see https://github.com/keonik/prisma-erd-generator/blob/main/src/generate.ts
// see https://github.com/samchon/prisma-markdown/blob/master/src/executable/markdown.ts

// for graphviz
// see https://www.npmjs.com/package/@hpcc-js/wasm

export type PrismaGrapherConfig = {
  disabled?: string;
  title?: string;
  lineColor?: string;
  headerBackgroundColor?: string;
  headerForegroundColor?: string;
  bodyBackgroundColor?: string;
  bodyForegroundColor?: string;
  typeForegroundColor?: string;
};

const identifier = (...parts: string[]) =>
  parts
    .filter(Boolean)
    .map((part) => JSON.stringify(part))
    .join(":");

export async function generate(options: GeneratorOptions) {
  const config = options.generator.config as PrismaGrapherConfig;
  const output = options.generator.output?.value || "./prisma/ERD.svg";
  const disabled = config.disabled === "true" || process.env.DISABLE_PRISMA_GRAPHER === "true";
  const title = config.title ?? "";
  const lineColor = config.lineColor ?? "#004cff";
  const headerBackgroundColor = config.headerBackgroundColor ?? "#bacefc";
  const headerForegroundColor = config.headerForegroundColor ?? "black";
  const bodyBackgroundColor = config.bodyBackgroundColor ?? "white";
  const bodyForegroundColor = config.bodyForegroundColor ?? "black";
  const typeForegroundColor = config.typeForegroundColor ?? "#4f83ff";

  if (disabled) {
    return console.log("prisma grapher is disabled");
  }

  const enums = options.dmmf.datamodel.enums;
  const models = [...options.dmmf.datamodel.models, ...options.dmmf.datamodel.types];

  // relation dot definitions
  const enumByName = enums.reduce(
    (acc, _enum) => ((acc[_enum.name] = _enum), acc),
    {} as Record<string, DMMF.DatamodelEnum>,
  );
  const modelByName = models.reduce(
    (acc, model, index) => ((acc[model.name] = { ...model, index }), acc),
    {} as Record<string, DMMF.Model & { index: number }>,
  );

  type Vertex = [string, string];
  type Edge = [Vertex, Vertex];

  const verticesLeft = [] as Vertex[];
  const verticesRight = [] as Vertex[];

  const relations = Object.values(modelByName)
    .flatMap((aModel) =>
      aModel.fields
        .filter((aField) => enumByName[aField.type] || modelByName[aField.type])
        .map<Edge>((aField) => {
          const a = [aModel.name, aField.name] as Vertex;

          if (enumByName[aField.type]) {
            const bModel = enumByName[aField.type];
            const b = [bModel.name, ""] as Vertex;
            return [b, a];
          } else {
            const bModel = modelByName[aField.type];
            const bField = bModel.fields.find((it) => it.type === aModel.name);
            const b = [bModel.name, bField?.name ?? ""] as Vertex;

            return !aField.isList // evaluate direction
              ? [b, a]
              : !bField?.isList
              ? [a, b]
              : aModel.index < bModel.index
              ? [a, b]
              : [b, a];
          }
        }),
    )
    .map((edge) => JSON.stringify(edge))
    .filter((it, i, arr) => arr.indexOf(it) === i)
    .map((it) => JSON.parse(it) as Edge)
    .map((edge) => (verticesLeft.push(edge[0]), verticesRight.push(edge[1]), edge));

  const relationDotDefinitions = relations.map(
    (edge) => `
      edge [dir=both arrowtail=normal arrowhead=none]
      ${identifier(...edge[0])} -> ${identifier(...edge[1])}
    `,
  );

  // enum dot definitions
  const enumDotDefinitions = enums.map(
    (_enum) => `
    ${identifier(_enum.name)} [
      shape=plain
      label=<<table
        border="0"
        cellborder="1"
        cellspacing="0"
        cellpadding="4"
        bgcolor="${bodyBackgroundColor}"
        color="${lineColor}"
      >
        <tr>
          <td
            cellpadding="8"
            bgcolor="${headerBackgroundColor}"
          ><font color="${headerForegroundColor}">${"&nbsp;".repeat(2)}${_enum.name}${"&nbsp;".repeat(2)}</font></td>
        </tr>
        <tr>
          <td>
            <table
              border="0"
              cellborder="0"
              cellspacing="0"
              cellpadding="4"
              bgcolor="${bodyBackgroundColor}"
            >
              ${_enum.values
                .map((value) => `<tr><td><font color="${bodyForegroundColor}">${value.name}</font></td></tr>`)
                .join("\n")}
            </table>
          </td>
        </tr>
      </table>>
    ]
  `,
  );

  // model and type dot definitions
  const modelDotDefinitions = models.map(
    (model) => `
    ${identifier(model.name)} [
      shape=plain
      label=<<table
        border="0"
        cellborder="1"
        cellspacing="0"
        cellpadding="4"
        bgcolor="${bodyBackgroundColor}"
        color="${lineColor}"
      >
        <tr>
          <td
            cellpadding="8"
            bgcolor="${headerBackgroundColor}"
          ><font color="${headerForegroundColor}">${"&nbsp;".repeat(2)}${model.name}${"&nbsp;".repeat(2)}</font></td>
        </tr>
        <tr>
          <td>
            <table
              border="0"
              cellborder="0"
              cellspacing="0"
              cellpadding="4"
              bgcolor="${bodyBackgroundColor}"
            >
              ${model.fields
                .filter(
                  // exclude relation fields
                  (field, i, fields) =>
                    !fields.some((otherField) => otherField.relationFromFields?.includes(field.name)),
                )
                .map(
                  (field) => `<tr>
                    <td cellpadding="0" port="${
                      field.kind === "enum" ||
                      verticesRight.find((vertex) => vertex[0] === model.name && vertex[1] === field.name)
                        ? field.name
                        : ""
                    }">${
                      field.isId
                        ? `<font color="${bodyForegroundColor}">&#9670;</font>`
                        : field.relationFromFields !== undefined || field.kind === "enum"
                        ? `<font color="${bodyForegroundColor}">&#9671;</font>`
                        : ""
                    }</td>
                    <td align="left"><font color="${bodyForegroundColor}">${field.name}&nbsp;&nbsp;</font></td>
                    <td align="left" port="${
                      verticesLeft.find((vertex) => vertex[0] === model.name && vertex[1] === field.name)
                        ? field.name
                        : ""
                    }"><font color="${typeForegroundColor}">${[
                      field.type,
                      field.isList ? "&nbsp;[&nbsp;]" : "",
                      !field.isRequired ? "?" : "",
                    ].join("")}&nbsp;</font></td>
                  </tr>`,
                )
                .join("\n")}
            </table>
          </td>
        </tr>
      </table>>
    ]
  `,
  );

  const dotSource = `
    digraph ERD {
      graph [
        ${title ? `label=${identifier(title)}` : ""}
        pad=0.4
        labelloc="t"
        fontname="Arial,sans-serif"
        rankdir="LR"
      ]
      node [
        fontname="Arial,sans-serif"
        shape=record
        style=filled
        color="${lineColor}"
        fillcolor="${headerBackgroundColor}"
        fontcolor="${headerForegroundColor}"
      ]
      edge [
        fontname="Arial,sans-serif"
        color="${lineColor}"
        minlen=5
        arrowsize=1.2
      ]
      ${relationDotDefinitions.join("\n")}
      ${enumDotDefinitions.join("\n")}
      ${modelDotDefinitions.join("\n")}
    }
  `;

  // debug
  // await writeFile("./prisma-grapher-debug.dot", dotSource);

  const svg = await graphviz.dot(dotSource, "svg");

  await writeFile(output, svg);

  return console.log(`prisma grapher generated erd at "${output}"`);
}
