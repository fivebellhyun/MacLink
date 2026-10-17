# MacLink Google 로그인 설정

MacLink의 소유자 로그인은 Google 계정으로 처리합니다. 초대받은 접속자는 로그인하지 않고 초대 링크와 호스트의 Google 로그인 이메일을 입력합니다.

## Google Cloud에서 발급하기

1. [Google Cloud Console](https://console.cloud.google.com/)에서 MacLink용 프로젝트를 선택하거나 만듭니다.
2. **Google Auth Platform**을 열고 앱 이름을 `MacLink`로 설정합니다. 지원 이메일과 개발자 연락처에는 실제 관리하는 이메일을 입력합니다.
3. 외부 사용자가 접속하는 서비스라면 대상 사용자를 **외부**로 설정합니다. 테스트 상태에서는 먼저 본인의 Google 계정을 테스트 사용자로 추가합니다. 출시 전에는 대상 사용자 설정과 Google에서 요구하는 게시 절차를 마칩니다.
4. **클라이언트 → 클라이언트 만들기 → 웹 애플리케이션**을 선택합니다.
5. **승인된 리디렉션 URI**에 다음 주소를 정확히 등록합니다.

   ```text
   https://www.maclink.cloud/auth/google/callback
   ```

6. 이 구현은 브라우저용 Google SDK 대신 서버에서 인증 코드를 교환합니다. 승인된 JavaScript 원본은 이 흐름에서 필요하지 않습니다. 다른 기능을 위해 등록한다면 원본은 `https://www.maclink.cloud`입니다.
7. 생성된 클라이언트의 JSON 파일을 Mac에 다운로드합니다. 파일에는 Client Secret이 들어 있으므로 저장소에 커밋하거나 채팅에 내용을 붙여넣지 마세요. 설정을 이어갈 때 파일의 저장 경로만 알려주면 됩니다.

요청 범위는 `openid email profile`입니다. Gmail, Drive, Calendar 접근 권한이나 오프라인 액세스는 요청하지 않습니다.

## 공개 정책 URL

Google Auth Platform의 앱 브랜드 정보에 다음 주소를 등록합니다.

| 항목 | 주소 |
| --- | --- |
| 홈페이지 | https://www.maclink.cloud/ |
| 개인정보 처리방침 | https://www.maclink.cloud/privacy |
| 서비스 약관 | https://www.maclink.cloud/terms |

운영자는 오종현, 공개 문의처는 taoss3932@gmail.com입니다. 두 정책은 로그인 없이 열 수 있으며, 페이지 상단에서 한국어·영어를 선택할 수 있습니다.

## Sites 운영 환경 변수

다음 값은 소스나 README가 아니라 Sites의 서버 환경 변수로 등록합니다.

| 이름 | 값 | 보관 방식 |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Google에서 발급한 웹 클라이언트 ID | 서버 환경 변수 |
| `GOOGLE_CLIENT_SECRET` | 같은 클라이언트의 Client Secret | 비밀 값 |
| `AUTH_BASE_URL` | `https://www.maclink.cloud` | 서버 환경 변수 |

기존 `TURN_CONFIG_KEY`는 유지합니다. 로그인용 키로 재사용하지 않습니다. 환경 변수 등록 후, Google 로그인 코드와 DB 마이그레이션 `0005_google_auth`가 포함된 버전을 배포해야 적용됩니다.

## 도메인 확인

`https://www.maclink.cloud/`이 실제 MacLink 페이지를 표시하고 Sites 도메인 상태가 활성화되어야 합니다. HTTPS 인증서 발급만으로 사이트 연결이 끝난 것은 아닙니다.

2026-10-17 최종 확인 시 DNS의 CNAME·소유권 TXT가 설정되었으며, Sites 도메인과 HTTPS 인증서 모두 `active`로 확인되었습니다.

로그인을 시작한 주소와 콜백 주소는 모두 위의 `www` 주소를 사용합니다. 다른 호스트나 HTTP 주소로 오가면 로그인 쿠키가 연결되지 않으므로 인증을 완료할 수 없습니다.

## 기존 기기 가져오기

Google 로그인 후 **내 기기 → 기존 연결 키로 기기 가져오기**에서 이전 `maclink-config.json`을 선택합니다. 연결 키를 확인한 기기 한 대만 현재 Google 계정으로 가져옵니다.

- 같은 이메일이라는 이유만으로 기존 소유 계정과 자동 연결하지 않습니다.
- 가져올 때 이전 초대 링크와 접속 세션을 종료합니다. 완료 후 새 초대 링크를 발급합니다.
- 커넥터의 기기 ID와 연결 키는 유지합니다.
- 다른 Google 계정에 이미 연결된 기기는 이 방식으로 가져올 수 없습니다.
- 이전 계정의 다른 기기와 TURN 설정은 함께 가져오지 않습니다. TURN은 새 계정에서 다시 설정합니다.

## 적용 확인

Google 로그인 완료 후 계정 이메일과 내 기기 목록을 확인합니다. 로그아웃 후 기기 관리가 차단되는지, 새 초대로 원격 화면과 마우스·키보드가 동작하는지도 확인합니다.

코드 테스트는 합성 서명 토큰과 테스트용 네트워크를 사용합니다. Google 클라이언트 설정, 실제 사용자 동의, 운영 도메인의 로그인 성공은 별도로 확인해야 합니다.

참고: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Google ID 토큰 검증](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
