import { ParsedFile, TechStack, Badge, GitignorePreset } from "./types.js";

// ─── .gitignore templates ─────────────────────────────────────────────────────

const GITIGNORE_TEMPLATES: Record<GitignorePreset, string> = {
  node: `node_modules/\ndist/\nbuild/\n.next/\nout/\n.nuxt/\n.env\n.env.local\n.env.*.local\nnpm-debug.log*\nyarn-debug.log*\npnpm-debug.log*\n.DS_Store\n.vscode/\n.idea/\n*.tsbuildinfo\n`,
  python: `__pycache__/\n*.py[cod]\n*.pyc\n.env\n.venv\nenv/\nvenv/\nENV/\ndist/\nbuild/\n*.egg-info/\n.pytest_cache/\n.coverage\nhtmlcov/\n.mypy_cache/\n.DS_Store\n.vscode/\n.idea/\n`,
  rust: `/target/\n.DS_Store\n.vscode/\n.idea/\n`,
  go: `*.exe\n*.dll\n*.so\n*.dylib\n*.test\n/dist/\n/build/\n.DS_Store\n.vscode/\n.idea/\n`,
  java: `target/\nbuild/\n*.class\n*.jar\n*.war\n.idea/\n*.iml\n.eclipse/\n.settings/\n.project\n.classpath\n.DS_Store\n`,
  ruby: `.bundle/\nvendor/bundle/\n.env\n*.log\ntmp/\nlog/\n.DS_Store\n.vscode/\n.idea/\n`,
  dart: `.dart_tool/\nbuild/\n.pub-cache/\n.pub/\n.flutter-plugins\n.flutter-plugins-dependencies\n*.g.dart\n.env\n.DS_Store\n`,
  csharp: `bin/\nobj/\n*.user\n*.suo\n.vs/\nnuget/\n*.nupkg\n.env\n.DS_Store\n.vscode/\n.idea/\n`,
  php: `vendor/\n.env\n.phpunit.cache/\nstorage/logs/\nbootstrap/cache/\n.DS_Store\n.vscode/\n.idea/\n`,
  cpp: `build/\ncmake-build-*/\n*.o\n*.obj\n*.a\n*.lib\n*.so\n*.dll\n*.exe\n.DS_Store\n.vscode/\n.idea/\nCMakeCache.txt\nCMakeFiles/\n`,
  generic: `.DS_Store\n.vscode/\n.idea/\n*.swp\n*.swo\n.env\n.env.local\n*.log\n`,
};

// ─── Detection rule schema ────────────────────────────────────────────────────

interface DetectionRule {
  /** Regexes tested against individual file paths */
  filePatterns?: RegExp[];
  /** Regexes tested against ALL file contents combined */
  contentPatterns?: RegExp[];
  /**
   * When true, contentPatterns only add to the score if at least one
   * filePattern already matched. Prevents false positives when a project's
   * source code (e.g. this detector itself) contains framework-specific
   * strings like "SpringApplication" as text.
   */
  requireFileMatch?: boolean;
  weight: number;
  stack: Partial<TechStack>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function badge(label: string, message: string, color: string, logoName?: string): Badge {
  return { label, message, color, logoName };
}

// ─── Detection rules (highest weight = most specific) ─────────────────────────

const RULES: DetectionRule[] = [

  // ── New Programming Language implementation ────────────────────────────────
  // Highest priority: if someone is building a language, that IS the project.
  {
    filePatterns: [
      /\.g4$/,          // ANTLR4 grammar
      /\.pest$/,        // Pest PEG grammar
      /\.ebnf$/,        // EBNF grammar
      /\.bnf$/,         // BNF grammar
      /\.lark$/,        // Lark grammar (Python)
      /\.ohm$/,         // Ohm grammar (JS)
      /\.g$/,           // generic grammar
      /grammar\.(js|ts|py|rs|go)$/i,
    ],
    contentPatterns: [
      /\bTokenKind\b|\bTokenType\b|\benum\s+Token\b/,
      /\bAstNode\b|\bExprKind\b|\bStmtKind\b|\bNodeKind\b/,
      /\bfn\s+eval_|\bfn\s+interpret|\bfn\s+compile/,
      /class\s+Lexer|class\s+Parser|class\s+Interpreter|class\s+Compiler/,
      /def\s+parse_|def\s+lex_|def\s+tokenize/,
    ],
    weight: 20,
    stack: {
      name: "Programming Language Implementation",
      frameworks: [],
      languages: [],          // filled in at runtime by detectTechStack
      packageManager: "none", // overridden if cargo/pip/npm found
      gitignorePreset: "generic",
      badges: [badge("Language", "Implementation", "6E40C9")],
      isNewLanguage: true,
    },
  },

  // ── JavaScript / TypeScript frameworks ────────────────────────────────────

  {
    filePatterns: [/next\.config\.(js|ts|mjs)$/, /app\/layout\.tsx?$/, /pages\/_app\.tsx?$/],
    weight: 15,
    stack: {
      name: "Next.js",
      frameworks: ["Next.js", "React"],
      languages: ["TypeScript"],
      packageManager: "npm",
      gitignorePreset: "node",
      badges: [
        badge("Next.js", "14+", "000000", "next.js"),
        badge("React", "18+", "61DAFB", "react"),
        badge("TypeScript", "5+", "3178C6", "typescript"),
      ],
    },
  },
  {
    filePatterns: [/nuxt\.config\.(js|ts|mjs)$/, /\.nuxt\//],
    weight: 14,
    stack: {
      name: "Nuxt.js",
      frameworks: ["Nuxt.js", "Vue"],
      languages: ["TypeScript"],
      packageManager: "npm",
      gitignorePreset: "node",
      badges: [
        badge("Nuxt", "3+", "00DC82", "nuxt.js"),
        badge("Vue", "3+", "4FC08D", "vue.js"),
      ],
    },
  },
  {
    filePatterns: [/astro\.config\.(js|ts|mjs)$/, /\.astro$/],
    weight: 14,
    stack: {
      name: "Astro",
      frameworks: ["Astro"],
      languages: ["TypeScript"],
      packageManager: "npm",
      gitignorePreset: "node",
      badges: [
        badge("Astro", "4+", "FF5D01", "astro"),
        badge("TypeScript", "5+", "3178C6", "typescript"),
      ],
    },
  },
  {
    filePatterns: [/remix\.config\.(js|ts)$/, /app\/root\.tsx?$/],
    weight: 14,
    stack: {
      name: "Remix",
      frameworks: ["Remix", "React"],
      languages: ["TypeScript"],
      packageManager: "npm",
      gitignorePreset: "node",
      badges: [
        badge("Remix", "2+", "000000", "remix"),
        badge("React", "18+", "61DAFB", "react"),
      ],
    },
  },
  {
    filePatterns: [/svelte\.config\.(js|ts)$/, /\.svelte$/],
    weight: 14,
    stack: {
      name: "SvelteKit",
      frameworks: ["SvelteKit", "Svelte"],
      languages: ["TypeScript"],
      packageManager: "npm",
      gitignorePreset: "node",
      badges: [
        badge("Svelte", "5+", "FF3E00", "svelte"),
        badge("TypeScript", "5+", "3178C6", "typescript"),
      ],
    },
  },
  {
    filePatterns: [/angular\.json$/, /\.component\.ts$/, /app\.module\.ts$/],
    weight: 13,
    stack: {
      name: "Angular",
      frameworks: ["Angular"],
      languages: ["TypeScript"],
      packageManager: "npm",
      gitignorePreset: "node",
      badges: [
        badge("Angular", "17+", "DD0031", "angular"),
        badge("TypeScript", "5+", "3178C6", "typescript"),
      ],
    },
  },
  {
    filePatterns: [/vite\.config\.(js|ts)$/, /src\/main\.tsx?$/, /src\/App\.tsx?$/],
    weight: 12,
    stack: {
      name: "React + Vite",
      frameworks: ["React", "Vite"],
      languages: ["TypeScript"],
      packageManager: "npm",
      gitignorePreset: "node",
      badges: [
        badge("React", "18+", "61DAFB", "react"),
        badge("Vite", "5+", "646CFF", "vite"),
      ],
    },
  },
  {
    filePatterns: [/vue\.config\.(js|ts)$/, /\.vue$/],
    weight: 12,
    stack: {
      name: "Vue",
      frameworks: ["Vue"],
      languages: ["TypeScript"],
      packageManager: "npm",
      gitignorePreset: "node",
      badges: [badge("Vue", "3+", "4FC08D", "vue.js")],
    },
  },
  {
    filePatterns: [/electron\.?(main|preload)\.(js|ts)$/, /electron-builder\.yml$/],
    contentPatterns: [/require\(['"]electron['"]\)|from ['"]electron['"]/],
    weight: 13,
    stack: {
      name: "Electron",
      frameworks: ["Electron"],
      languages: ["TypeScript"],
      packageManager: "npm",
      gitignorePreset: "node",
      badges: [
        badge("Electron", "28+", "47848F", "electron"),
        badge("TypeScript", "5+", "3178C6", "typescript"),
      ],
    },
  },

  // ── Tauri (Rust + Web) ────────────────────────────────────────────────────
  {
    filePatterns: [/tauri\.conf\.json$/, /src-tauri\/Cargo\.toml$/],
    weight: 15,
    stack: {
      name: "Tauri",
      frameworks: ["Tauri"],
      languages: ["Rust", "TypeScript"],
      packageManager: "cargo",
      gitignorePreset: "rust",
      badges: [
        badge("Tauri", "2+", "FFC131", "tauri"),
        badge("Rust", "stable", "000000", "rust"),
      ],
    },
  },

  // ── Mobile ────────────────────────────────────────────────────────────────
  {
    filePatterns: [/pubspec\.yaml$/, /\.dart$/],
    weight: 13,
    stack: {
      name: "Flutter",
      frameworks: ["Flutter"],
      languages: ["Dart"],
      packageManager: "none",
      gitignorePreset: "dart",
      badges: [
        badge("Flutter", "3+", "02569B", "flutter"),
        badge("Dart", "3+", "0175C2", "dart"),
      ],
    },
  },
  {
    filePatterns: [/AndroidManifest\.xml$/, /\.kt$/, /build\.gradle\.kts$/],
    weight: 13,
    stack: {
      name: "Android",
      frameworks: ["Android"],
      languages: ["Kotlin"],
      packageManager: "none",
      gitignorePreset: "java",
      badges: [
        badge("Android", "SDK", "3DDC84", "android"),
        badge("Kotlin", "1.9+", "7F52FF", "kotlin"),
      ],
    },
  },
  {
    filePatterns: [/\.xcodeproj\//, /\.xcworkspace\//, /\.swift$/],
    weight: 13,
    stack: {
      name: "iOS / Swift",
      frameworks: ["UIKit", "SwiftUI"],
      languages: ["Swift"],
      packageManager: "none",
      gitignorePreset: "generic",
      badges: [
        badge("Swift", "5+", "FA7343", "swift"),
        badge("Xcode", "15+", "147EFB", "xcode"),
      ],
    },
  },

  // ── Game / Creative ───────────────────────────────────────────────────────
  {
    filePatterns: [/\.unity$/, /ProjectSettings\/ProjectSettings\.asset$/, /Assets\/.*\.cs$/],
    weight: 15,
    stack: {
      name: "Unity",
      frameworks: ["Unity"],
      languages: ["C#"],
      packageManager: "none",
      gitignorePreset: "csharp",
      badges: [
        badge("Unity", "2022+", "000000", "unity"),
        badge("C%23", "latest", "239120", "csharp"),
      ],
    },
  },
  {
    filePatterns: [/project\.godot$/, /\.tscn$/, /\.gd$/],
    weight: 14,
    stack: {
      name: "Godot",
      frameworks: ["Godot"],
      languages: ["GDScript"],
      packageManager: "none",
      gitignorePreset: "generic",
      badges: [badge("Godot", "4+", "478CBF", "godot-engine")],
    },
  },

  // ── Python frameworks ─────────────────────────────────────────────────────
  {
    filePatterns: [/fastapi|uvicorn/i],
    contentPatterns: [/from fastapi|import FastAPI/],
    requireFileMatch: true,
    weight: 13,
    stack: {
      name: "FastAPI",
      frameworks: ["FastAPI"],
      languages: ["Python"],
      packageManager: "pip",
      gitignorePreset: "python",
      badges: [
        badge("FastAPI", "0.110+", "009688", "fastapi"),
        badge("Python", "3.11+", "3776AB", "python"),
      ],
    },
  },
  {
    filePatterns: [/manage\.py$/, /settings\.py$/, /wsgi\.py$/],
    contentPatterns: [/django\.setup|DJANGO_SETTINGS_MODULE|from django/],
    requireFileMatch: true,
    weight: 13,
    stack: {
      name: "Django",
      frameworks: ["Django"],
      languages: ["Python"],
      packageManager: "pip",
      gitignorePreset: "python",
      badges: [
        badge("Django", "5+", "092E20", "django"),
        badge("Python", "3.11+", "3776AB", "python"),
      ],
    },
  },
  {
    filePatterns: [/app\.py$/, /wsgi\.py$/],
    contentPatterns: [/from flask import|Flask\(__name__\)/],
    requireFileMatch: true,
    weight: 11,
    stack: {
      name: "Flask",
      frameworks: ["Flask"],
      languages: ["Python"],
      packageManager: "pip",
      gitignorePreset: "python",
      badges: [
        badge("Flask", "3+", "000000", "flask"),
        badge("Python", "3.11+", "3776AB", "python"),
      ],
    },
  },
  {
    filePatterns: [/requirements\.txt$/, /setup\.py$/, /pyproject\.toml$/, /\.py$/],
    weight: 5,
    stack: {
      name: "Python",
      frameworks: [],
      languages: ["Python"],
      packageManager: "pip",
      gitignorePreset: "python",
      badges: [badge("Python", "3.11+", "3776AB", "python")],
    },
  },

  // ── JVM ───────────────────────────────────────────────────────────────────
  {
    filePatterns: [/pom\.xml$/],
    contentPatterns: [/spring-boot|SpringApplication|@SpringBootApplication/],
    requireFileMatch: true,
    weight: 14,
    stack: {
      name: "Spring Boot",
      frameworks: ["Spring Boot"],
      languages: ["Java"],
      packageManager: "none",
      gitignorePreset: "java",
      badges: [
        badge("Spring Boot", "3+", "6DB33F", "spring"),
        badge("Java", "21+", "ED8B00", "openjdk"),
      ],
    },
  },
  {
    filePatterns: [/\.kt$/, /build\.gradle\.kts$/],
    weight: 8,
    stack: {
      name: "Kotlin",
      frameworks: [],
      languages: ["Kotlin"],
      packageManager: "none",
      gitignorePreset: "java",
      badges: [badge("Kotlin", "1.9+", "7F52FF", "kotlin")],
    },
  },
  {
    filePatterns: [/pom\.xml$/, /\.java$/, /build\.gradle$/],
    weight: 7,
    stack: {
      name: "Java",
      frameworks: [],
      languages: ["Java"],
      packageManager: "none",
      gitignorePreset: "java",
      badges: [badge("Java", "21+", "ED8B00", "openjdk")],
    },
  },
  {
    filePatterns: [/\.scala$/, /build\.sbt$/],
    weight: 9,
    stack: {
      name: "Scala",
      frameworks: [],
      languages: ["Scala"],
      packageManager: "none",
      gitignorePreset: "java",
      badges: [badge("Scala", "3+", "DC322F", "scala")],
    },
  },

  // ── .NET ──────────────────────────────────────────────────────────────────
  {
    filePatterns: [/\.csproj$/, /\.cs$/, /Program\.cs$/],
    weight: 9,
    stack: {
      name: ".NET",
      frameworks: [],
      languages: ["C#"],
      packageManager: "none",
      gitignorePreset: "csharp",
      badges: [
        badge(".NET", "8+", "512BD4", "dotnet"),
        badge("C%23", "12+", "239120", "csharp"),
      ],
    },
  },
  {
    filePatterns: [/\.fsproj$/, /\.fs$/],
    weight: 9,
    stack: {
      name: "F# / .NET",
      frameworks: [],
      languages: ["F#"],
      packageManager: "none",
      gitignorePreset: "csharp",
      badges: [badge("F%23", "latest", "378BBA", "fsharp")],
    },
  },

  // ── Ruby ──────────────────────────────────────────────────────────────────
  {
    filePatterns: [/Gemfile$/, /config\/routes\.rb$/, /app\/controllers\//],
    contentPatterns: [/Rails\.application|class Application < Rails/],
    requireFileMatch: true,
    weight: 13,
    stack: {
      name: "Ruby on Rails",
      frameworks: ["Rails"],
      languages: ["Ruby"],
      packageManager: "none",
      gitignorePreset: "ruby",
      badges: [
        badge("Rails", "7+", "CC0000", "ruby-on-rails"),
        badge("Ruby", "3.2+", "CC342D", "ruby"),
      ],
    },
  },
  {
    filePatterns: [/Gemfile$/, /\.rb$/],
    weight: 6,
    stack: {
      name: "Ruby",
      frameworks: [],
      languages: ["Ruby"],
      packageManager: "none",
      gitignorePreset: "ruby",
      badges: [badge("Ruby", "3.2+", "CC342D", "ruby")],
    },
  },

  // ── PHP ───────────────────────────────────────────────────────────────────
  {
    filePatterns: [/artisan$/, /app\/Http\/Controllers\//, /\.blade\.php$/],
    contentPatterns: [/Illuminate\\|Laravel/],
    requireFileMatch: true,
    weight: 13,
    stack: {
      name: "Laravel",
      frameworks: ["Laravel"],
      languages: ["PHP"],
      packageManager: "none",
      gitignorePreset: "php",
      badges: [
        badge("Laravel", "11+", "FF2D20", "laravel"),
        badge("PHP", "8.2+", "777BB4", "php"),
      ],
    },
  },
  {
    filePatterns: [/composer\.json$/, /\.php$/],
    weight: 5,
    stack: {
      name: "PHP",
      frameworks: [],
      languages: ["PHP"],
      packageManager: "none",
      gitignorePreset: "php",
      badges: [badge("PHP", "8.2+", "777BB4", "php")],
    },
  },

  // ── Elixir ────────────────────────────────────────────────────────────────
  {
    filePatterns: [/mix\.exs$/, /lib\/.*_web\//, /\.ex$/, /\.exs$/],
    contentPatterns: [/use Phoenix\.|Phoenix\.Router/],
    requireFileMatch: true,
    weight: 13,
    stack: {
      name: "Phoenix / Elixir",
      frameworks: ["Phoenix"],
      languages: ["Elixir"],
      packageManager: "none",
      gitignorePreset: "generic",
      badges: [
        badge("Phoenix", "1.7+", "FD4F00", "phoenixframework"),
        badge("Elixir", "1.16+", "4B275F", "elixir"),
      ],
    },
  },
  {
    filePatterns: [/mix\.exs$/, /\.ex$/, /\.exs$/],
    weight: 7,
    stack: {
      name: "Elixir",
      frameworks: [],
      languages: ["Elixir"],
      packageManager: "none",
      gitignorePreset: "generic",
      badges: [badge("Elixir", "1.16+", "4B275F", "elixir")],
    },
  },

  // ── Systems languages ─────────────────────────────────────────────────────
  {
    filePatterns: [/Cargo\.toml$/, /\.rs$/],
    weight: 8,
    stack: {
      name: "Rust",
      frameworks: [],
      languages: ["Rust"],
      packageManager: "cargo",
      gitignorePreset: "rust",
      badges: [badge("Rust", "stable", "000000", "rust")],
    },
  },
  {
    filePatterns: [/go\.mod$/, /go\.sum$/, /\.go$/],
    weight: 8,
    stack: {
      name: "Go",
      frameworks: [],
      languages: ["Go"],
      packageManager: "go",
      gitignorePreset: "go",
      badges: [badge("Go", "1.22+", "00ADD8", "go")],
    },
  },
  {
    filePatterns: [/CMakeLists\.txt$/, /\.cpp$/, /\.cc$/, /\.cxx$/, /\.hpp$/],
    weight: 8,
    stack: {
      name: "C++",
      frameworks: [],
      languages: ["C++"],
      packageManager: "none",
      gitignorePreset: "cpp",
      badges: [badge("C%2B%2B", "17+", "00599C", "cplusplus")],
    },
  },
  {
    filePatterns: [/Makefile$/, /\.c$/, /\.h$/],
    weight: 5,
    stack: {
      name: "C",
      frameworks: [],
      languages: ["C"],
      packageManager: "none",
      gitignorePreset: "cpp",
      badges: [badge("C", "C11+", "A8B9CC", "c")],
    },
  },
  {
    filePatterns: [/\.zig$/],
    weight: 9,
    stack: {
      name: "Zig",
      frameworks: [],
      languages: ["Zig"],
      packageManager: "none",
      gitignorePreset: "generic",
      badges: [badge("Zig", "0.13+", "F7A41D", "zig")],
    },
  },
  {
    filePatterns: [/\.nim$/, /\.nimble$/],
    weight: 9,
    stack: {
      name: "Nim",
      frameworks: [],
      languages: ["Nim"],
      packageManager: "none",
      gitignorePreset: "generic",
      badges: [badge("Nim", "2+", "FFE953", "nim")],
    },
  },

  // ── Functional ────────────────────────────────────────────────────────────
  {
    filePatterns: [/\.hs$/, /stack\.yaml$/, /package\.yaml$/],
    weight: 9,
    stack: {
      name: "Haskell",
      frameworks: [],
      languages: ["Haskell"],
      packageManager: "none",
      gitignorePreset: "generic",
      badges: [badge("Haskell", "GHC 9+", "5D4F85", "haskell")],
    },
  },
  {
    filePatterns: [/\.ml$/, /\.mli$/, /dune-project$/],
    weight: 9,
    stack: {
      name: "OCaml",
      frameworks: [],
      languages: ["OCaml"],
      packageManager: "none",
      gitignorePreset: "generic",
      badges: [badge("OCaml", "5+", "EC6813", "ocaml")],
    },
  },
  {
    filePatterns: [/\.clj$/, /\.cljs$/, /project\.clj$/, /deps\.edn$/],
    weight: 9,
    stack: {
      name: "Clojure",
      frameworks: [],
      languages: ["Clojure"],
      packageManager: "none",
      gitignorePreset: "java",
      badges: [badge("Clojure", "1.11+", "5881D8", "clojure")],
    },
  },
  {
    filePatterns: [/\.lua$/],
    weight: 6,
    stack: {
      name: "Lua",
      frameworks: [],
      languages: ["Lua"],
      packageManager: "none",
      gitignorePreset: "generic",
      badges: [badge("Lua", "5.4+", "2C2D72", "lua")],
    },
  },
  {
    filePatterns: [/\.r$/i, /\.rmd$/i, /DESCRIPTION$/],
    weight: 7,
    stack: {
      name: "R",
      frameworks: [],
      languages: ["R"],
      packageManager: "none",
      gitignorePreset: "generic",
      badges: [badge("R", "4+", "276DC3", "r")],
    },
  },

  // ── Node.js (lowest-weight fallback for JS/TS projects) ───────────────────
  {
    filePatterns: [/package\.json$/, /\.ts$/, /\.js$/],
    weight: 2,
    stack: {
      name: "Node.js",
      frameworks: [],
      languages: ["JavaScript", "TypeScript"],
      packageManager: "npm",
      gitignorePreset: "node",
      badges: [badge("Node.js", "18+", "339933", "node.js")],
    },
  },
];

// ─── Language file extension map (for detectAllLanguages) ─────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin", kts: "Kotlin",
  scala: "Scala",
  cs: "C#",
  fs: "F#",
  swift: "Swift",
  dart: "Dart",
  rb: "Ruby",
  php: "PHP",
  ex: "Elixir", exs: "Elixir",
  cpp: "C++", cc: "C++", cxx: "C++", hpp: "C++", hxx: "C++",
  c: "C", h: "C",
  zig: "Zig",
  nim: "Nim",
  hs: "Haskell",
  ml: "OCaml", mli: "OCaml",
  clj: "Clojure", cljs: "ClojureScript",
  lua: "Lua",
  r: "R",
  jl: "Julia",
  cr: "Crystal",
  pl: "Perl", pm: "Perl",
  erl: "Erlang", hrl: "Erlang",
  elm: "Elm",
  vue: "Vue",
  svelte: "Svelte",
  astro: "Astro",
  gd: "GDScript",
  gdshader: "GLSL",
  sh: "Shell", bash: "Shell", zsh: "Shell", fish: "Shell",
  sql: "SQL",
  graphql: "GraphQL", gql: "GraphQL",
  proto: "Protobuf",
  g4: "ANTLR Grammar",
  pest: "PEG Grammar",
  ebnf: "EBNF Grammar",
  bnf: "BNF Grammar",
};

// ─── Exports ──────────────────────────────────────────────────────────────────

export function detectTechStack(files: ParsedFile[]): TechStack {
  const filePaths = files.map((f) => f.path);
  const fileContents = files.map((f) => f.content).join("\n");

  let bestScore = 0;
  let bestStack: TechStack = {
    name: "Generic",
    frameworks: [],
    languages: [],
    packageManager: "none",
    gitignorePreset: "generic",
    badges: [],
  };

  for (const rule of RULES) {
    let score = 0;
    let fileMatchCount = 0;

    if (rule.filePatterns) {
      for (const pattern of rule.filePatterns) {
        if (filePaths.some((p) => pattern.test(p))) {
          score += rule.weight;
          fileMatchCount++;
        }
      }
    }

    // Skip content patterns when requireFileMatch is set and no file matched.
    // This prevents false positives when a project's own source code contains
    // framework keywords (e.g. a rule file that lists "SpringApplication").
    const canCheckContent = !rule.requireFileMatch || fileMatchCount > 0;
    if (rule.contentPatterns && canCheckContent) {
      for (const pattern of rule.contentPatterns) {
        if (pattern.test(fileContents)) score += rule.weight;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestStack = { ...(rule.stack as TechStack) };
    }
  }

  // For a new-language project, detect the implementation language separately
  if (bestStack.isNewLanguage) {
    bestStack.languages = detectAllLanguages(files).filter(
      (l) => !["ANTLR Grammar", "PEG Grammar", "EBNF Grammar", "BNF Grammar"].includes(l)
    );
  }

  // Package manager override from lockfiles
  if (filePaths.some((p) => p === "pnpm-lock.yaml")) bestStack.packageManager = "pnpm";
  else if (filePaths.some((p) => p === "yarn.lock")) bestStack.packageManager = "yarn";

  // Always ensure the platform badge is present — framework rules often omit it
  const PLATFORM_BADGE: Partial<Record<TechStack["packageManager"], Badge>> = {
    npm:   badge("Node.js", "18+", "339933", "node.js"),
    yarn:  badge("Node.js", "18+", "339933", "node.js"),
    pnpm:  badge("Node.js", "18+", "339933", "node.js"),
    pip:   badge("Python", "3.10+", "3776AB", "python"),
    cargo: badge("Rust", "stable", "CE422B", "rust"),
    go:    badge("Go", "1.21+", "00ADD8", "go"),
  };
  const platformBadge = PLATFORM_BADGE[bestStack.packageManager];
  if (platformBadge && !bestStack.badges.some((b) => b.label === platformBadge.label)) {
    bestStack.badges = [platformBadge, ...bestStack.badges];
  }

  return bestStack;
}

/** Returns every programming language found in the file list, deduplicated. */
export function detectAllLanguages(files: ParsedFile[]): string[] {
  const found = new Set<string>();
  for (const f of files) {
    const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
    const lang = EXT_TO_LANGUAGE[ext];
    if (lang) found.add(lang);
  }
  return Array.from(found).sort();
}

export function getGitignoreContent(preset: GitignorePreset): string {
  return GITIGNORE_TEMPLATES[preset] ?? GITIGNORE_TEMPLATES.generic;
}

export function renderBadges(badges: Badge[]): string {
  return badges
    .map((b) => {
      const logo = b.logoName ? `&logo=${encodeURIComponent(b.logoName)}&logoColor=white` : "";
      const url = `https://img.shields.io/badge/${encodeURIComponent(b.label)}-${encodeURIComponent(b.message)}-${b.color}?style=flat-square${logo}`;
      return `![${b.label}](${url})`;
    })
    .join(" ");
}
