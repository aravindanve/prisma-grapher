import * as child_process from "child_process";

test("blog.prisma", async () => {
  const schemaName = "blog.prisma";
  const outputName = "blog.svg";
  const outputFolder = "test";
  child_process.execSync(`rm -f ${outputFolder}/${outputName}`);
  child_process.execSync(`prisma generate --schema ./prisma/${schemaName}`);
  const listFile = child_process.execSync(`ls -la ${outputFolder}/${outputName}`);

  // did it generate a file
  expect(listFile.toString()).toContain(outputName);

  const svgAsString = child_process.execSync(`cat ${outputFolder}/${outputName}`).toString();

  // did it generate a file with the correct content
  expect(svgAsString).toContain(`<svg`);
  expect(svgAsString).toContain(`Role`);
  expect(svgAsString).toContain(`User`);
  expect(svgAsString).toContain(`Post`);
  expect(svgAsString).toContain(`Comment`);
});
