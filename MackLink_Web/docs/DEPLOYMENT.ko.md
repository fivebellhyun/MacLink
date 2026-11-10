# MacLink 웹사이트 배포: Cloudflare Workers + D1

MacLink 웹사이트는 ChatGPT Sites 없이 **본인 Cloudflare 계정**에 직접 배포합니다. Sites도 내부적으로 Cloudflare Workers와 D1 위에서 동작했기 때문에, 앱 코드·DB 스키마·마이그레이션은 그대로 사용합니다. 배포 도구로는 Cloudflare 공식 CLI인 `wrangler`를 사용합니다.

| 구성 요소 | 이전 (ChatGPT Sites) | 현재 |
| --- | --- | --- |
| 서버 실행 | Sites가 관리하는 Worker | 본인 계정의 Worker `maclink` (`wrangler.jsonc`) |
| 데이터베이스 | Sites가 주입한 D1 `DB` | 본인 계정의 D1 `maclink`, 바인딩 `DB` |
| 정적 파일·설치 파일 | Sites 자산 | Workers Static Assets (`public/`, 바인딩 `ASSETS`) |
| 환경 변수·비밀 값 | Sites 서버 환경 변수 | `wrangler.jsonc`의 `vars`와 `wrangler secret` |
| 도메인 | Sites 도메인 연결(CNAME·TXT) | Workers Custom Domain |
| 배포 설정 파일 | `.openai/hosting.json` (Git 미추적) | `wrangler.jsonc` (Git 추적, 비밀 값 없음) |

아래 명령은 모두 `MackLink_Web/`에서 실행합니다.

## 준비물

- Cloudflare 계정. 운영용으로는 **Workers Paid** 플랜을 권장합니다([요금 참고](#요금과-사용량-참고)).
- Node.js 22.13 이상, pnpm 11.25.0
- Google OAuth 웹 클라이언트 ([Google 로그인 설정](GOOGLE_LOGIN_SETUP.ko.md))
- `www.maclink.cloud`를 연결하려면 `maclink.cloud` DNS를 같은 Cloudflare 계정에서 관리해야 합니다.

## 1. 설치와 Cloudflare 로그인

```bash
cd MackLink_Web
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler whoami
```

CI처럼 브라우저를 열 수 없는 환경에서는 `wrangler login` 대신 `CLOUDFLARE_API_TOKEN`과 `CLOUDFLARE_ACCOUNT_ID` 환경 변수를 사용합니다. 토큰은 **Edit Cloudflare Workers** 템플릿에 D1 편집 권한을 더해 만듭니다. 토큰을 저장소에 커밋하지 마세요.

## 2. D1 데이터베이스 만들기

운영 D1 `maclink`(APAC)은 이미 만들어져 있고, 그 ID가 `wrangler.jsonc`에 들어 있습니다. 같은 Cloudflare 계정에 배포한다면 이 단계를 건너뜁니다.

다른 계정에 별도 사이트를 배포할 때만 새 DB를 만듭니다.

```bash
pnpm exec wrangler d1 create maclink --location apac
```

출력된 `database_id`로 `wrangler.jsonc`의 `d1_databases` 항목을 바꿉니다.

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "maclink",
    "database_id": "출력된-ID",
    "migrations_dir": "drizzle"
  }
]
```

`database_id`는 비밀 값이 아니며 Cloudflare API 토큰 없이는 접근할 수 없습니다. 다른 사람이 이 저장소로 별도 사이트를 운영하려면 각자 자신의 ID로 바꿉니다.

## 3. 스키마 마이그레이션

```bash
pnpm db:migrate:remote
```

`drizzle/`의 SQL 파일을 순서대로 적용하고 `d1_migrations` 테이블에 기록합니다. 이전 Sites DB의 데이터를 가져올 경우에는 이 단계 대신 [기존 데이터 이전](#기존-sites-데이터-이전)을 따릅니다.

## 4. 비밀 값 등록

```bash
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put TURN_CONFIG_KEY
```

| 이름 | 값 | 저장 위치 |
| --- | --- | --- |
| `AUTH_BASE_URL` | `https://www.maclink.cloud` | `wrangler.jsonc`의 `vars` |
| `GOOGLE_CLIENT_ID` | Google 웹 클라이언트 ID | `wrangler secret` (배포별 값이라 Git에 넣지 않음) |
| `GOOGLE_CLIENT_SECRET` | 같은 클라이언트의 Client Secret | `wrangler secret` |
| `TURN_CONFIG_KEY` | 소문자 16진수 64자 | `wrangler secret` |

`TURN_CONFIG_KEY`는 소유자가 등록한 TURN 키를 DB에 암호화해 저장할 때 사용합니다. 기존 데이터를 이전한다면 Sites에서 쓰던 값과 **같은 값**을 넣어야 저장된 TURN 설정을 복호화할 수 있습니다. 새로 시작한다면 `openssl rand -hex 32`로 만듭니다. 값을 잃어버리면 소유자가 **연결 설정**에서 TURN 키를 다시 등록해야 하며, 그동안에는 직접 WebRTC 연결만 사용합니다.

Worker가 아직 없으면 `wrangler secret put`이 같은 이름의 Worker를 먼저 만들지 묻습니다. 승인해도 되고, 5단계 배포 후에 등록해도 됩니다.

## 5. 배포

```bash
pnpm run deploy
```

`pnpm run deploy`는 `vite build` 후 `wrangler deploy`를 실행합니다. `pnpm deploy`는 pnpm 자체 명령이므로 반드시 `run`을 붙입니다. 배포가 끝나면 `https://maclink.<계정-서브도메인>.workers.dev` 주소가 출력됩니다.

`AUTH_BASE_URL`과 다른 주소에서는 Google 로그인과 기기 등록이 동작하지 않습니다. 도메인을 옮기기 전에 `workers.dev` 주소에서 로그인까지 시험하려면 Google OAuth 클라이언트에 `https://maclink.<계정-서브도메인>.workers.dev/auth/google/callback`을 추가하고, 다음처럼 해당 주소로 한 번 배포합니다.

```bash
pnpm build
pnpm exec wrangler deploy --var AUTH_BASE_URL:https://maclink.<계정-서브도메인>.workers.dev
```

이후 `pnpm run deploy`를 다시 실행하면 `wrangler.jsonc`의 운영 주소로 돌아갑니다.

## 6. www.maclink.cloud 연결

1. `maclink.cloud`가 아직 Cloudflare에 없다면 대시보드의 **Add a domain**으로 추가하고, 도메인 등록 기관에서 네임서버를 Cloudflare가 안내한 값으로 바꿉니다.
2. DNS에서 Sites 연결용 `www` CNAME 레코드와 Sites 소유권 TXT 레코드를 삭제합니다. 같은 이름의 레코드가 남아 있으면 Custom Domain을 만들 수 없습니다.
3. `wrangler.jsonc`의 `routes` 주석을 해제하고 다시 배포합니다.

   ```jsonc
   "routes": [{ "pattern": "www.maclink.cloud", "custom_domain": true }]
   ```

   ```bash
   pnpm run deploy
   ```

   Custom Domain은 DNS 레코드와 HTTPS 인증서를 자동으로 만듭니다. 대시보드의 **Workers & Pages → maclink → Settings → Domains & Routes**에서도 추가할 수 있습니다.
4. 루트 도메인 `maclink.cloud` 접속을 `www`로 보내려면 Cloudflare **Redirect Rules**로 `https://www.maclink.cloud`에 301 리디렉션을 만듭니다(선택).

Google OAuth 리디렉션 URI(`https://www.maclink.cloud/auth/google/callback`)와 커넥터에 내장된 사이트 주소(`MacLink_Connector/app_runtime.py`의 `WEBSITE_URL`)는 바뀌지 않으므로 수정할 필요가 없습니다. 도메인 자체를 바꾸면 OAuth 설정, `AUTH_BASE_URL`, 커넥터의 `WEBSITE_URL`·업데이트 주소를 함께 바꾸고 커넥터를 다시 빌드해야 합니다.

## 7. 배포 확인

```bash
curl -s https://www.maclink.cloud/api/me
# {"signedIn":false,"email":null,"ownerId":null}
curl -s https://www.maclink.cloud/api/downloads/MacLink-Connector-arm64.dmg.sha256
```

브라우저에서 Google 로그인, **내 기기** 목록, 커넥터 등록, 원격 연결과 소리·입력을 차례로 확인합니다. 서버 로그는 `pnpm exec wrangler tail`로 실시간 확인할 수 있습니다.

## 기존 Sites 데이터 이전

기존 D1 데이터를 SQL 덤프로 받을 수 있다면 계정·기기 등록·TURN 설정을 유지할 수 있습니다. 덤프는 Sites의 최신 스키마(`0009_connector_enrollment` 적용 후)여야 합니다.

1. 2단계에서 만든 **빈** DB에 3단계 마이그레이션을 실행하지 않고 덤프를 가져옵니다.

   ```bash
   pnpm exec wrangler d1 execute maclink --remote --file=./maclink-sites-dump.sql
   ```

2. 덤프에 `d1_migrations` 테이블이 없다면, 이미 적용된 마이그레이션을 기록해 이후 `pnpm db:migrate:remote`가 기존 테이블을 다시 만들지 않게 합니다.

   ```bash
   pnpm exec wrangler d1 execute maclink --remote --command "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL); INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0000_ambitious_black_queen.sql'),('0001_magenta_whistler.sql'),('0002_gigantic_thena.sql'),('0003_funny_runaways.sql'),('0004_host_email_guard.sql'),('0005_google_auth.sql'),('0006_remove_https_relay.sql'),('0007_account_devices.sql'),('0008_restore_email_invites.sql'),('0009_connector_enrollment.sql');"
   pnpm db:migrate:remote   # "No migrations to apply"가 나와야 합니다.
   ```

3. `TURN_CONFIG_KEY`를 Sites와 같은 값으로 등록합니다.

로그인 쿠키는 같은 `www.maclink.cloud` 도메인에 남아 있으므로, `auth_sessions`를 가져오면 기존 로그인도 만료 전까지 유지됩니다. 덤프를 만든 뒤 Sites에서 생긴 변경은 옮겨지지 않으니, 도메인을 전환하기 직전에 덤프를 만드는 것이 좋습니다.

덤프를 받을 수 없다면 빈 DB로 시작합니다. 소유자는 Google로 다시 로그인하고, 각 Mac의 커넥터에서 **Google 계정으로 연결**을 다시 실행해 기기를 등록합니다. 기존 커넥터는 연결 키가 서버에 없다는 오류를 표시하며, 다시 등록하면 정상 동작합니다. TURN을 쓰던 소유자는 **연결 설정**에서 TURN 키를 다시 등록합니다.

## 로컬 개발

```bash
cp .dev.vars.example .dev.vars   # 값을 채웁니다. .dev.vars는 Git에서 제외됩니다.
pnpm db:migrate:local
pnpm dev                          # http://localhost:5173
```

`pnpm preview`는 빌드 결과를 로컬 workerd에서 실행합니다. 로컬 D1 데이터는 `.wrangler/state`에 저장됩니다. 로컬에서 Google 로그인을 시험하려면 OAuth 클라이언트에 `http://localhost:5173/auth/google/callback`을 추가합니다.

## 되돌리기와 백업

- 이전 Worker 버전으로 되돌리기: `pnpm exec wrangler rollback`
- D1 특정 시점 복원(Time Travel): `pnpm exec wrangler d1 time-travel restore maclink --timestamp=<UNIX 시각 또는 RFC3339>`
- 수동 백업: `pnpm exec wrangler d1 export maclink --remote --output=./maclink-backup.sql` (결과 파일에는 개인정보가 들어 있으므로 저장소에 커밋하지 마세요.)

## 요금과 사용량 참고

정적 파일 요청은 Workers 요청 수에 포함되지 않습니다. 반면 온라인 상태의 커넥터는 4초마다 서버에 상태를 보고하므로, **켜져 있는 Mac 1대당 하루 약 21,600건**의 Worker 요청과 비슷한 수의 D1 쓰기가 발생합니다. 원격 연결 중에는 브라우저가 2초마다 세션 상태를 확인합니다.

작성 시점 기준 Workers Free 플랜은 하루 요청 10만 건, 요청당 CPU 10 ms, D1 하루 쓰기 10만 행 정도로 제한되어 상시 켜둔 Mac 몇 대 수준에서 한도에 닿을 수 있습니다. Google 로그인의 토큰 검증 같은 요청은 CPU 시간이 더 필요할 수 있으므로 운영에는 Workers Paid(월 5달러부터)를 권장합니다. 정확한 한도와 요금은 [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/)과 [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/)에서 확인하세요. 선택 사항인 Cloudflare TURN 요금은 소유자가 등록한 TURN 계정에 별도로 청구됩니다.
