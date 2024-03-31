import { Graphviz } from "@hpcc-js/wasm";
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
  ignoreEnums?: string;
  lineColor?: string;
  headerBackgroundColor?: string;
  headerForegroundColor?: string;
  bodyBackgroundColor?: string;
  bodyBackgroundColor2?: string;
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
  const ignoreEnums = config.ignoreEnums === "true";
  const lineColor = config.lineColor ?? "#004cff";
  const headerBackgroundColor = config.headerBackgroundColor ?? "#bacefc";
  const headerForegroundColor = config.headerForegroundColor ?? "black";
  const bodyBackgroundColor = config.bodyBackgroundColor ?? "white";
  const bodyBackgroundColor2 = config.bodyBackgroundColor2 ?? "#e8efff";
  const bodyForegroundColor = config.bodyForegroundColor ?? "black";
  const typeForegroundColor = config.typeForegroundColor ?? "#4f83ff";

  if (disabled) {
    return console.log("prisma grapher is disabled");
  }

  const enums = options.dmmf.datamodel.enums;
  const models = [...options.dmmf.datamodel.models, ...options.dmmf.datamodel.types];

  // relation dot definitions
  const enumByName = !ignoreEnums
    ? enums.reduce((acc, _enum) => ((acc[_enum.name] = _enum), acc), {} as Record<string, DMMF.DatamodelEnum>)
    : {};

  const modelByName = models.reduce(
    (acc, model, index) => ((acc[model.name] = { ...model, index }), acc),
    {} as Record<string, DMMF.Model & { index: number }>,
  );

  type Vertex = [string, string];
  type EdgeType = "1-1" | "1-m" | "m-m";
  type Edge = [Vertex, Vertex, EdgeType];

  const verticesLeft = [] as Vertex[];
  const verticesRight = [] as Vertex[];

  const relations = Object.values(modelByName)
    .flatMap((aModel) =>
      aModel.fields
        .filter((aField) => enumByName[aField.type] || modelByName[aField.type])
        .filter((aField) => aField.type !== aModel.name) // skip self relations
        .map<Edge>((aField) => {
          const a = [aModel.name, aField.name] as Vertex;

          if (enumByName[aField.type]) {
            const bModel = enumByName[aField.type];
            const b = [bModel.name, ""] as Vertex;
            const t = !aField.isList ? "1-m" : "m-m";
            return [b, a, t];
          } else {
            const bModel = modelByName[aField.type];
            const bField = bModel.fields.find((it) => it.type === aModel.name);
            const b = [bModel.name, bField?.name ?? ""] as Vertex;

            // determine order and type
            return !aField.isList && bField?.isList
              ? [b, a, "1-m"]
              : aField.isList && !bField?.isList
                ? [a, b, "1-m"]
                : aModel.index < bModel.index
                  ? [a, b, !aField.isList ? "1-1" : "m-m"]
                  : [b, a, !aField.isList ? "1-1" : "m-m"];
          }
        }),
    )
    .map((edge) => JSON.stringify(edge))
    .filter((it, i, arr) => arr.indexOf(it) === i)
    .map((it) => JSON.parse(it) as Edge)
    .map((edge) => (verticesLeft.push(edge[0]), verticesRight.push(edge[1]), edge));

  const relationDotDefinitions = relations.map(
    (edge) => `
      edge [
        dir=both
        arrowtail=${edge[2].startsWith("1-") ? "tee" : "crow"}
        arrowhead=${edge[2].endsWith("-1") ? "tee" : "crow"}
      ]
      ${identifier(...edge[0])}:e -> ${identifier(...edge[1])}:w
    `,
  );

  const nodeTableAttributes = `
    bgcolor="${bodyBackgroundColor}"
    color="${lineColor}"
    border="0"
    cellborder="0"
    cellspacing="0"
    cellpadding="0"`;

  const headerTdAttributes = `
    bgcolor="${headerBackgroundColor}"
    color="${lineColor}"
    border="1"
    cellpadding="8"`;

  const fieldsTableAttributes = `
    bgcolor="${bodyBackgroundColor}"
    color="${lineColor}"
    border="0"
    cellborder="0"
    cellspacing="0"
    cellpadding="4"`;

  // enum dot definitions
  const enumDotDefinitions = !ignoreEnums
    ? enums.map(
        (_enum) => `
          ${identifier(_enum.name)} [
            shape=plain
            label=<<table ${nodeTableAttributes}>
              <tr>
                <td ${headerTdAttributes}><font color="${headerForegroundColor}">${_enum.name}</font></td>
              </tr>
              <tr>
                <td>
                  <table ${fieldsTableAttributes}>
                    ${_enum.values
                      .map((value, i, values) => {
                        const bgcolor = i % 2 === 0 ? bodyBackgroundColor : bodyBackgroundColor2;
                        const bottomBorder = i === values.length - 1 ? "B" : "";
                        return `<tr>
                          <td
                            bgcolor="${bgcolor}"
                            color="${lineColor}"
                            border="1"
                            sides="L${bottomBorder}"
                          ></td>
                          <td
                            bgcolor="${bgcolor}"
                            color="${lineColor}"
                            ${bottomBorder ? `border="1" sides="${bottomBorder}"` : ""}
                          ><font color="${bodyForegroundColor}">${value.name}</font></td>
                          <td
                            bgcolor="${bgcolor}"
                            color="${lineColor}"
                            border="1"
                            sides="R${bottomBorder}"
                          ></td>
                        </tr>`;
                      })
                      .join("\n")}
                  </table>
                </td>
              </tr>
            </table>>
          ]
        `,
      )
    : [];

  // model and type dot definitions
  const modelDotDefinitions = models.map(
    (model) => `
      ${identifier(model.name)} [
        shape=plain
        label=<<table ${nodeTableAttributes}>
          <tr>
            <td ${headerTdAttributes}><font color="${headerForegroundColor}">${model.name}</font></td>
          </tr>
          <tr>
            <td>
              <table ${fieldsTableAttributes}>
                ${model.fields
                  .filter(
                    // exclude relation fields
                    (field, i, fields) =>
                      !fields.some((otherField) => otherField.relationFromFields?.includes(field.name)),
                  )
                  .map((field, i, fields) => {
                    const bgcolor = i % 2 === 0 ? bodyBackgroundColor : bodyBackgroundColor2;
                    const portLeft =
                      field.kind === "enum" ||
                      verticesRight.find((vertex) => vertex[0] === model.name && vertex[1] === field.name)
                        ? field.name
                        : "";

                    const portRight = verticesLeft.find(
                      (vertex) => vertex[0] === model.name && vertex[1] === field.name,
                    )
                      ? field.name
                      : "";

                    const bottomBorder = i === fields.length - 1 ? "B" : "";

                    return `<tr>
                      <td
                        bgcolor="${bgcolor}"
                        color="${lineColor}"
                        border="1"
                        sides="L${bottomBorder}"
                        port="${portLeft}"
                      >${
                        field.isId
                          ? `<font color="${bodyForegroundColor}">&#9670;</font>`
                          : field.relationFromFields !== undefined || field.kind === "enum"
                            ? `<font color="${bodyForegroundColor}">&#9671;</font>`
                            : ""
                      }</td>
                      <td
                        bgcolor="${bgcolor}"
                        color="${lineColor}"
                        ${bottomBorder ? `border="1" sides="${bottomBorder}"` : ""}
                        align="left"
                      ><font color="${bodyForegroundColor}">${field.name}&nbsp;&nbsp;</font></td>
                      <td
                        bgcolor="${bgcolor}"
                        color="${lineColor}"
                        ${bottomBorder ? `border="1" sides="${bottomBorder}"` : ""}
                        align="left"
                      ><font color="${typeForegroundColor}">${[
                        field.type,
                        field.isList ? "&nbsp;[&nbsp;]" : "",
                        !field.isRequired ? "&nbsp;?" : "",
                      ].join("")}&nbsp;&nbsp;</font></td>
                      <td
                        bgcolor="${bgcolor}"
                        color="${lineColor}"
                        border="1"
                        sides="R${bottomBorder}"
                        align="left"
                        port="${portRight}"
                      ></td>
                    </tr>`;
                  })
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

  const graphviz = await Graphviz.load();
  const svg = graphviz.dot(dotSource, "svg");

  await writeFile(output, svg);

  return console.log(`prisma grapher generated erd at "${output}"`);
}
