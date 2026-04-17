import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import { GitignorePreset } from "./types.js";
import { getGitignoreContent } from "./detector.js";
import { writeFile, writeLicenseFile } from "./scaffold.js";
import { printSuccess, printInfo, printWarning, c } from "./ui.js";
import { loadConfig } from "./config.js";
import { generateCiWorkflow } from "./ci-generator.js";
import { generateDockerfile, generateDockerCompose } from "./docker-generator.js";
import { generateHooksConfig, applyHooksConfig } from "./hooks-generator.js";

interface StackTemplate {
  label: string;
  value: string;
  gitignore: GitignorePreset;
  packageManager: string;
  files: Array<{ path: string; content: string }>;
}

const TEMPLATES: StackTemplate[] = [
  {
    label: "Node.js + TypeScript (ESM)",
    value: "node-ts",
    gitignore: "node",
    packageManager: "npm",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "{{name}}",
          version: "1.0.0",
          description: "{{description}}",
          type: "module",
          main: "dist/index.js",
          scripts: {
            build: "tsc",
            dev: "tsx src/index.ts",
            start: "node dist/index.js",
            lint: "eslint src/",
          },
          dependencies: {},
          devDependencies: {
            typescript: "^5.7.0",
            tsx: "^4.19.0",
            "@types/node": "^22.0.0",
          },
        }, null, 2),
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "Node16",
            moduleResolution: "Node16",
            outDir: "dist",
            rootDir: "src",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            declaration: true,
          },
          include: ["src"],
        }, null, 2),
      },
      { path: "src/index.ts", content: 'console.log("Hello, world!");\n' },
    ],
  },
  {
    label: "React + Vite + TypeScript",
    value: "react-vite",
    gitignore: "node",
    packageManager: "npm",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "{{name}}",
          version: "0.1.0",
          description: "{{description}}",
          type: "module",
          scripts: {
            dev: "vite",
            build: "tsc && vite build",
            preview: "vite preview",
          },
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
          devDependencies: {
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            "@vitejs/plugin-react": "^4.3.0",
            typescript: "^5.7.0",
            vite: "^6.0.0",
          },
        }, null, 2),
      },
      {
        path: "index.html",
        content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{name}}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: "src/main.tsx",
        content: `import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
`,
      },
      {
        path: "src/App.tsx",
        content: `export default function App() {
  return <h1>Hello, world!</h1>;
}
`,
      },
      {
        path: "vite.config.ts",
        content: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`,
      },
    ],
  },
  {
    label: "Next.js (App Router)",
    value: "nextjs",
    gitignore: "node",
    packageManager: "npm",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "{{name}}",
          version: "0.1.0",
          description: "{{description}}",
          scripts: { dev: "next dev", build: "next build", start: "next start" },
          dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
          devDependencies: { typescript: "^5.7.0", "@types/react": "^19.0.0", "@types/node": "^22.0.0" },
        }, null, 2),
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2017",
            lib: ["dom", "dom.iterable", "esnext"],
            jsx: "preserve",
            module: "esnext",
            moduleResolution: "bundler",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            plugins: [{ name: "next" }],
            paths: { "@/*": ["./src/*"] },
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
        }, null, 2),
      },
      {
        path: "src/app/layout.tsx",
        content: `export const metadata = { title: "{{name}}", description: "{{description}}" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      },
      {
        path: "src/app/page.tsx",
        content: `export default function Home() {
  return <h1>Hello, world!</h1>;
}
`,
      },
    ],
  },
  {
    label: "Express API + TypeScript",
    value: "express-api",
    gitignore: "node",
    packageManager: "npm",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "{{name}}",
          version: "1.0.0",
          description: "{{description}}",
          type: "module",
          main: "dist/index.js",
          scripts: {
            build: "tsc",
            dev: "tsx watch src/index.ts",
            start: "node dist/index.js",
          },
          dependencies: { express: "^5.0.0" },
          devDependencies: {
            "@types/express": "^5.0.0",
            "@types/node": "^22.0.0",
            typescript: "^5.7.0",
            tsx: "^4.19.0",
          },
        }, null, 2),
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "Node16",
            moduleResolution: "Node16",
            outDir: "dist",
            rootDir: "src",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ["src"],
        }, null, 2),
      },
      {
        path: "src/index.ts",
        content: `import express from "express";

const app = express();
const port = process.env["PORT"] ?? 3000;

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "Hello, world!" });
});

app.listen(port, () => {
  console.log(\`Server running on http://localhost:\${port}\`);
});
`,
      },
      { path: ".env.example", content: "PORT=3000\n" },
    ],
  },
  {
    label: "Python (FastAPI)",
    value: "python-fastapi",
    gitignore: "python",
    packageManager: "pip",
    files: [
      {
        path: "requirements.txt",
        content: "fastapi>=0.115.0\nuvicorn>=0.32.0\n",
      },
      {
        path: "main.py",
        content: `from fastapi import FastAPI

app = FastAPI()


@app.get("/")
async def root():
    return {"message": "Hello, world!"}
`,
      },
      { path: ".env.example", content: "PORT=8000\n" },
    ],
  },
  {
    label: "CLI Tool (Node.js + Commander)",
    value: "node-cli",
    gitignore: "node",
    packageManager: "npm",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "{{name}}",
          version: "1.0.0",
          description: "{{description}}",
          type: "module",
          bin: { "{{name}}": "dist/index.js" },
          main: "dist/index.js",
          scripts: {
            build: "tsc",
            dev: "tsx src/index.ts",
            start: "node dist/index.js",
          },
          dependencies: { commander: "^13.0.0", chalk: "^5.4.0" },
          devDependencies: {
            typescript: "^5.7.0",
            tsx: "^4.19.0",
            "@types/node": "^22.0.0",
          },
        }, null, 2),
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "Node16",
            moduleResolution: "Node16",
            outDir: "dist",
            rootDir: "src",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            declaration: true,
          },
          include: ["src"],
        }, null, 2),
      },
      {
        path: "src/index.ts",
        content: `#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("{{name}}")
  .description("{{description}}")
  .version("1.0.0");

program
  .command("hello")
  .description("Say hello")
  .argument("[name]", "Name to greet", "world")
  .action((name: string) => {
    console.log(\`Hello, \${name}!\`);
  });

program.parse();
`,
      },
    ],
  },
];

function applyPlaceholders(content: string, name: string, description: string): string {
  return content.replace(/\{\{name\}\}/g, name).replace(/\{\{description\}\}/g, description);
}

export async function runInit(): Promise<void> {
  const cfg = loadConfig();

  const { projectName } = await inquirer.prompt<{ projectName: string }>([{
    type: "input",
    name: "projectName",
    message: "Project name:",
    validate: (v: string) =>
      /^[a-zA-Z0-9_.-]+$/.test(v.trim()) || "Only letters, numbers, hyphens, dots, or underscores",
  }]);

  const { description } = await inquirer.prompt<{ description: string }>([{
    type: "input",
    name: "description",
    message: "Short description:",
    default: `A new ${projectName} project`,
  }]);

  const { templateValue } = await inquirer.prompt<{ templateValue: string }>([{
    type: "list",
    name: "templateValue",
    message: "Pick a stack:",
    choices: TEMPLATES.map((t) => ({ name: t.label, value: t.value })),
  }]);

  const template = TEMPLATES.find((t) => t.value === templateValue)!;

  const { extras } = await inquirer.prompt<{ extras: string[] }>([{
    type: "checkbox",
    name: "extras",
    message: "Add extras:",
    choices: [
      { name: "GitHub Actions CI workflow", value: "ci", checked: true },
      { name: "Dockerfile + docker-compose", value: "docker" },
      { name: "Pre-commit hooks (husky + lint-staged)", value: "hooks" },
    ],
  }]);

  const addCi = extras.includes("ci");
  const addDocker = extras.includes("docker");
  const addHooks = extras.includes("hooks");

  const outputDir = path.resolve(process.cwd(), projectName);

  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length > 0) {
    printWarning(`Directory ${c.path(outputDir)} already exists and is not empty.`);
    const { proceed } = await inquirer.prompt<{ proceed: boolean }>([{
      type: "confirm",
      name: "proceed",
      message: "Continue anyway? (existing files may be overwritten)",
      default: false,
    }]);
    if (!proceed) {
      printInfo("Aborted.");
      return;
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });

  for (const file of template.files) {
    const content = applyPlaceholders(file.content, projectName, description);
    writeFile(outputDir, file.path, content);
  }

  writeFile(outputDir, ".gitignore", getGitignoreContent(template.gitignore));

  if (addCi) {
    const ciContent = generateCiWorkflow({
      gitignorePreset: template.gitignore,
      packageManager: template.packageManager,
      hasTests: false,
      files: template.files.map((file) => file.path),
    });
    writeFile(outputDir, ".github/workflows/ci.yml", ciContent);
    printSuccess("GitHub Actions CI workflow generated");
  }

  if (addDocker) {
    const dockerOpts = {
      gitignorePreset: template.gitignore,
      packageManager: template.packageManager,
      files: template.files.map((file) => file.path),
    };
    writeFile(outputDir, "Dockerfile", generateDockerfile(dockerOpts));
    writeFile(outputDir, "docker-compose.yml", generateDockerCompose(dockerOpts));
    printSuccess("Dockerfile and docker-compose.yml generated");
  }

  if (addHooks) {
    const hooksResult = generateHooksConfig({
      gitignorePreset: template.gitignore,
      packageManager: template.packageManager,
      hasLint: true, hasFormat: false, hasTypecheck: false,
    });
    if (hooksResult) {
      const applied = applyHooksConfig(outputDir, hooksResult);
      if (applied.packageJsonUpdated) {
        printSuccess("package.json updated with hook dependencies");
      }
      printSuccess("Pre-commit hooks generated");
      for (const warning of applied.warnings) {
        printWarning(warning);
      }
    } else {
      printWarning("Pre-commit hooks are currently only supported for Node-based projects with package.json.");
    }
  }

  writeLicenseFile(outputDir, cfg.defaultLicense ?? "MIT", cfg.projectAuthor ?? cfg.githubUsername);

  let fileCount = template.files.length + 1;
  if (addCi) fileCount++;
  if (addDocker) fileCount += 2;
  if (addHooks) fileCount += 2;
  printSuccess(`Scaffolded ${c.bold(String(fileCount))} files in ${c.path(outputDir)}`);
  printInfo(`Next: cd ${projectName} && ${template.packageManager} install`);
}
