# claude-ship

[![npm version](https://img.shields.io/npm/v/@binxgodteli/claude-ship?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/@binxgodteli/claude-ship)
[![npm downloads](https://img.shields.io/npm/dm/@binxgodteli/claude-ship?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@binxgodteli/claude-ship)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

**Ngôn ngữ / Language:** [English](README.md) | **Tiếng Việt**

> Đưa project được tạo bởi Claude lên GitHub chỉ trong vài giây — phân tích, tạo cấu trúc, và publish chỉ với một lệnh.

---

## Bắt đầu nhanh

```bash
# 1. Sao chép nội dung hội thoại Claude vào một file
# 2. Ship lên GitHub repo mới chỉ với một lệnh
npx @binxgodteli/claude-ship ship --file ./claude-output.txt --name my-project

# Push một project local có sẵn
npx @binxgodteli/claude-ship push --no-readme

# Tạo lại README bằng AI
npx @binxgodteli/claude-ship readme --provider gemini --api-key YOUR_KEY
```

Không cần cài đặt phức tạp. `claude-ship` tự động tìm GitHub token từ `gh` CLI, biến môi trường `GITHUB_TOKEN`, hoặc config đã lưu.

---

## Cài đặt

```bash
# Chạy trực tiếp không cần cài (dùng một lần)
npx @binxgodteli/claude-ship --help

# Cài đặt toàn cục
npm install -g @binxgodteli/claude-ship
claude-ship --help
```

---

## Tính năng

- **Phân tích output Claude** — trích xuất file từ các code block và thẻ `<antArtifact>`
- **Tự động tạo cấu trúc project** — ghi file, tạo `.gitignore` phù hợp với tech stack được phát hiện
- **Tạo README bằng AI** — hỗ trợ Anthropic Claude và Google Gemini; 4 mức độ chi tiết, 3 tone, hỗ trợ tiếng Việt
- **Tích hợp GitHub** — tạo repo (cá nhân hoặc org, public hoặc private) qua Octokit; xử lý force-push tương tác
- **Push project có sẵn** — không cần output Claude; tự tạo repo nếu chưa có
- **Chế độ dry-run** — xem trước tất cả thao tác mà không ghi file hay gọi API
- **Config mã hóa** — API key và token được lưu với AES-256-CBC tại `~/.claudeship/config.json`
- **Hỗ trợ SSH/HTTPS** — cấu hình theo từng project hoặc toàn cục

---

## Các lệnh

### `ship` — Phân tích, tạo cấu trúc và publish

Phân tích output Claude, tạo thư mục project, và đẩy lên GitHub repo mới.

```bash
npx @binxgodteli/claude-ship ship --file ./claude-output.txt --name my-project --desc "Mô tả project"

# Repo private với README bằng Gemini
npx @binxgodteli/claude-ship ship --file ./output.txt --name my-project --private --provider gemini --api-key KEY

# Xem trước mà không thực hiện gì
npx @binxgodteli/claude-ship ship --file ./output.txt --name my-project -d
```

| Flag | Mô tả |
| :--- | :---- |
| `--file <path>` | Đường dẫn file chứa output Claude |
| `--name <name>` | Tên project / repository |
| `--desc <description>` | Mô tả ngắn về project |
| `--out <dir>` | Thư mục đầu ra (mặc định: `./<project-name>`) |
| `--private` | Tạo GitHub repo private |
| `--no-readme` | Bỏ qua việc tạo README bằng AI |
| `--vi` | Tạo README bằng tiếng Việt |
| `--provider <name>` | AI provider: `anthropic` hoặc `gemini` |
| `--api-key <key>` | API key cho provider đã chọn |
| `--detail <level>` | Mức chi tiết README: `short`, `normal`, `large`, `carefully` |
| `--style <style>` | Tone README: `practical`, `balanced` (mặc định), `marketing` |
| `--max-tokens <n>` | Số token tối đa cho README (`0` = không giới hạn) |
| `--token <token>` | GitHub personal access token |
| `--org <org>` | GitHub organization để tạo repo |
| `--branch <name>` | Tên branch (mặc định: `main`) |
| `--no-push` | Chỉ tạo file local, không push lên GitHub |
| `-d, --dry-run` | Xem trước — không ghi file, không gọi API |

---

### `push` — Push project có sẵn

Push project local lên GitHub. Tự tạo repo nếu chưa tồn tại; xử lý remote bị diverged một cách tương tác.

```bash
# Push thư mục hiện tại (giữ nguyên README)
npx @binxgodteli/claude-ship push --no-readme

# Push thư mục cụ thể, tạo lại README bằng AI
npx @binxgodteli/claude-ship push --dir ./my-project --provider gemini --api-key KEY

# Push lên org, repo private
npx @binxgodteli/claude-ship push --org my-org --private --no-readme
```

| Flag | Mô tả |
| :--- | :---- |
| `--dir <path>` | Thư mục project (mặc định: thư mục hiện tại) |
| `--name <name>` | Tên repo (mặc định: từ `package.json` hoặc tên thư mục) |
| `--desc <description>` | Mô tả repo |
| `--private` | Tạo repo private |
| `--no-readme` | Bỏ qua việc tạo lại README |
| `--vi` | Tạo README bằng tiếng Việt |
| `--provider <name>` | AI provider: `anthropic` hoặc `gemini` |
| `--api-key <key>` | API key cho provider đã chọn |
| `--detail <level>` | Mức chi tiết README: `short`, `normal`, `large`, `carefully` |
| `--style <style>` | Tone: `practical`, `balanced`, `marketing` |
| `--max-tokens <n>` | Số token tối đa cho README |
| `--token <token>` | GitHub personal access token |
| `--org <org>` | GitHub organization |
| `--branch <name>` | Tên branch (mặc định: `main`) |
| `--message <msg>` | Nội dung commit (mặc định: `🚀 Update via claude-ship`) |

---

### `readme` — Tạo lại README

Tạo lại README cho một project thư mục có sẵn.

```bash
npx @binxgodteli/claude-ship readme
npx @binxgodteli/claude-ship readme --dir ./my-project --provider gemini --vi --api-key KEY
```

| Flag | Mô tả |
| :--- | :---- |
| `--dir <path>` | Thư mục project (mặc định: thư mục hiện tại) |
| `--provider <name>` | AI provider: `anthropic` (mặc định) hoặc `gemini` |
| `--api-key <key>` | API key cho provider đã chọn |
| `--vi` | Tạo bằng tiếng Việt |
| `--detail <level>` | Mức chi tiết: `short`, `normal`, `large`, `carefully` |
| `--style <style>` | Tone: `practical`, `balanced`, `marketing` |
| `--max-tokens <n>` | Số token tối đa (`0` = không giới hạn) |
| `--license <type>` | Loại giấy phép (ví dụ: `MIT`, `Apache-2.0`) |
| `--author <name>` | Tên tác giả cho dòng bản quyền |
| `--github-username <name>` | GitHub username cho biểu đồ star history |
| `--no-screenshot` | Bỏ qua phần screenshot placeholder |

---

### `config` — Cài đặt tương tác

Mở TUI để lưu API key, GitHub token và các tùy chọn mặc định.

```bash
npx @binxgodteli/claude-ship config
```

Các mục: **AI Keys** · **GitHub** (token hoặc OAuth) · **Defaults** (privacy, org, branch) · **README** (chi tiết, giấy phép, tác giả) · **Files** (glob patterns loại trừ file)

---

### `name` — Đặt tên repo mặc định

```bash
npx @binxgodteli/claude-ship name my-default-repo
npx @binxgodteli/claude-ship name ""   # xóa mặc định
```

---

## Cấu hình

Cài đặt được lưu tại `~/.claudeship/config.json`. Quản lý qua `claude-ship config` hoặc các flag.

**Thứ tự ưu tiên GitHub token**: flag `--token` → `gh auth token` → biến môi trường `GITHUB_TOKEN` → `GH_TOKEN` → config đã lưu.

### Biến môi trường

| Biến | Mô tả |
| :--- | :---- |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub Personal Access Token |
| `CLAUDE_SHIP_CLIENT_ID` | GitHub OAuth App client ID cho device flow |

### Các trường trong config

| Trường | Mô tả | Mặc định |
| :----- | :---- | :------- |
| `defaultProvider` | AI provider (`anthropic` hoặc `gemini`) | `anthropic` |
| `defaultPrivate` | Độ hiển thị repo | `false` |
| `githubUsername` | GitHub username | `""` |
| `defaultOrg` | GitHub organization | `""` |
| `defaultBranch` | Tên branch mặc định | `main` |
| `useSshRemote` | Dùng SSH thay vì HTTPS | `false` |
| `defaultReadmeDetail` | Mức chi tiết README mặc định | `normal` |
| `defaultLicense` | Loại giấy phép | `MIT` |
| `projectAuthor` | Tên tác giả cho bản quyền | `""` |
| `defaultVi` | Tạo README bằng tiếng Việt mặc định | `false` |
| `maxReadmeTokens` | Token tối đa cho AI README (`0` = không giới hạn) | `0` |
| `gitIncludePatterns` | Glob patterns đưa vào Git commit | `[]` |
| `gitExcludePatterns` | Glob patterns loại khỏi Git commit | `[]` |
| `aiExcludePatterns` | File không gửi cho AI (`.env*`, `*.key`, v.v.) | `[]` |
| `readmeExcludePatterns` | File loại khỏi context README | `[]` |

Các trường được mã hóa: `anthropicApiKey`, `geminiApiKey`, `githubToken` (AES-256-CBC).

---

## Xử lý sự cố

**"No GitHub token found"** — Chạy `gh auth login`, đặt `GITHUB_TOKEN`, hoặc chạy `claude-ship config`.

**Lỗi AI key** — Kiểm tra key trong `claude-ship config` hoặc truyền `--api-key`. Kiểm tra billing/quota trên dashboard của provider.

**Parse file sai** — Dùng `-d` (dry-run) để kiểm tra. Đảm bảo code block trong output Claude dùng fenced code blocks chuẩn (` ``` `).

**Tạo repo thất bại** — Xác nhận token có quyền `repo`. Kiểm tra tên repo chưa bị trùng. Với org, xác nhận bạn có quyền write.

---

## Đóng góp

1. Fork và clone repo
2. `npm install`
3. Thực hiện thay đổi, chạy `npm run lint` và `npm test`
4. Mở PR vào nhánh `main`

---

## Star History

<p align="center">
  <a href="https://star-history.com/#binxgtl/claude-ship&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=binxgtl/claude-ship&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=binxgtl/claude-ship&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=binxgtl/claude-ship&type=Date" width="600" />
    </picture>
  </a>
</p>

---

[MIT](LICENSE) © 2026 binxgtl
