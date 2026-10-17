export type LegalSection={id:string;title:string;paragraphs?:string[];bullets?:string[];table?:{headers:string[];rows:string[][]};links?:{label:string;href:string}[]};
export type LegalContent={title:string;subtitle:string;summary:string[];sections:LegalSection[]};
export type LegalKind='privacy'|'terms';
export type LegalLanguage='ko'|'en';
export const LEGAL_OPERATOR='오종현';
export const LEGAL_EMAIL='taoss3932@gmail.com';
export const LEGAL_EFFECTIVE_DATE='2026-10-17';
export const legalDocuments:Record<LegalKind,Record<LegalLanguage,LegalContent>>={
  "privacy": {
    "ko": {
      "title": "개인정보 처리방침",
      "subtitle": "MacLink가 어떤 정보를 처리하고, 화면과 입력을 어떻게 전달하는지 안내합니다.",
      "summary": [
        "화면과 원격 입력은 WebRTC 직접 연결 또는 암호화된 TURN 중계로 전달합니다. 웹사이트에 화면·입력을 업로드하거나 저장하지 않습니다.",
        "이메일은 계정·기기 확인에 사용합니다. 광고 추적이나 AI 모델 학습 목적으로 사용하지 않습니다.",
        "기기 등록 해제와 계정 정보 삭제는 다릅니다. 계정 삭제는 아래 문의처로 요청할 수 있습니다."
      ],
      "sections": [
        {
          "id": "operator",
          "title": "1. 운영자와 적용 범위",
          "paragraphs": [
            "MacLink는 오종현이 운영하는 원격 화면 공유·기기 제어 서비스입니다. 이 방침은 https://www.maclink.cloud 및 MacLink 커넥터에서 운영자가 처리하는 개인정보에 적용됩니다.",
            "개인정보 보호 및 고충처리 담당자: 오종현. 문의·열람·정정·삭제·처리정지·동의 철회 요청: taoss3932@gmail.com.",
            "기기 소유자는 Google 계정으로 로그인합니다. Google 인증 서비스 자체에는 Google의 정책도 적용됩니다. 이전 서비스에서 생성된 계정·기기 정보가 남아 있는 경우에도 이 방침의 권리 요청과 삭제 기준이 적용됩니다."
          ]
        },
        {
          "id": "collection",
          "title": "2. 처리하는 정보와 목적",
          "table": {
            "headers": [
              "구분",
              "처리 항목",
              "목적"
            ],
            "rows": [
              [
                "계정 인증",
                "인증 제공자의 계정 식별자, 이메일, 제공된 표시 이름. Google 로그인 시 Google 계정 고유 식별자와 이메일 인증 여부",
                "로그인, 소유자 식별, 기기 관리, 권리 요청 확인"
              ],
              [
                "기기·접속 관리",
                "기기 이름·ID, 연결 키의 해시, 앱 버전, 화면·입력 권한 상태, 온라인 상태·최근 접속 시각",
                "커넥터 인증, 기기 목록, 연결 가능 여부 확인"
              ],
              [
                "초대·연결",
                "초대·세션 ID, 비밀 값의 해시, 호스트 이메일의 검증용 해시, 권한·접속 상태·시각·종료 사유, 화질 설정, WebRTC 연결 정보(SDP/ICE에 포함될 수 있는 IP·포트)",
                "초대 확인, 연결 협상, 접근 권한 회수, 재연결 및 장애 진단"
              ],
              [
                "화면·원격 입력",
                "선택한 화면, 마우스 좌표·클릭·휠, 키 이벤트, 텍스트 보내기로 제출한 내용",
                "소유자가 허용한 화면 공유와 원격 조작 — 서비스 서버에 업로드하지 않고 WebRTC로 전달 — 서비스 서버에 업로드하지 않고 WebRTC로 전달"
              ],
              [
                "선택적 TURN 설정",
                "이용자가 등록한 Cloudflare TURN Key ID·API Token, 임시 중계 자격 증명",
                "직접 연결이 어려운 네트워크의 중계 연결"
              ],
              [
                "브라우저·보안·문의",
                "언어·키보드 매핑 설정, 현재 세션 정보, IP·요청 시각·브라우저 정보 등 인프라 보안 정보, 이용자가 보내는 이메일·진단 자료",
                "사용 설정 유지, 연결 복구, 보안·장애 대응, 문의 처리"
              ]
            ]
          }
        },
        {
          "id": "basis",
          "title": "3. 수집 방법과 처리 근거",
          "paragraphs": [
            "정보는 로그인 제공자의 인증 응답, 이용자의 등록·설정·문의, 커넥터 상태 보고, 원격 연결 및 브라우저·호스팅 서비스의 동작을 통해 처리합니다. 계정·기기 관리와 요청한 연결의 제공에 필요한 정보는 서비스 이용계약의 이행을 위해 처리합니다.",
            "동의가 필요한 선택 정보나 목적 외 처리는 해당 목적·항목·보유기간을 별도로 안내하고 필요한 동의를 받습니다. 보안·오남용 대응은 관련 법령이 허용하는 범위에서 필요한 최소 정보로 수행합니다.",
            "로그인이나 필수 연결 정보 제공을 거부하면 기기 등록·원격 접속이 제한됩니다. 초대받은 접속자는 소유자 계정으로 로그인할 필요가 없습니다. TURN 키 등록과 문의 자료 제출은 선택 사항입니다."
          ]
        },
        {
          "id": "transport",
          "title": "4. 화면·입력의 전달과 임시 저장",
          "paragraphs": [
            "WebRTC 직접 연결에서는 화면과 입력을 암호화된 통신으로 호스트와 접속자 사이에 전달합니다. TURN을 이용하면 중계 제공자가 암호화된 패킷과 통신 메타데이터를 처리합니다.",
            "화면·키보드·마우스·텍스트 보내기의 내용은 WebRTC 영상·데이터 채널로만 전달합니다. HTTPS 화면·입력 보조 중계는 제공하지 않으며 서비스 서버가 해당 내용을 받아 저장하는 API도 제공하지 않습니다. 웹사이트·로그인·권한 확인·연결 협상은 HTTPS로 보호합니다.",
            "화면에 보이는 문서·알림·계정·민감정보도 접속자에게 보일 수 있습니다. 공유 전 불필요한 창과 알림을 닫고, 제3자의 정보를 공유할 권한을 확인하세요. 현재 오디오 송출, 전용 파일 전송 및 화면 녹화 기능은 제공하지 않습니다.",
            "운영자는 원격 화면이나 입력을 광고, 판매, 이용자 프로파일링 또는 AI 모델 학습 목적으로 사용하지 않습니다. 장애·보안 조사나 법률상 의무를 위한 접근이 필요한 경우에도 필요한 범위와 적법한 근거로 제한합니다."
          ]
        },
        {
          "id": "retention",
          "title": "5. 보유기간과 삭제 방식",
          "table": {
            "headers": [
              "정보",
              "보유·정리 기준"
            ],
            "rows": [
              [
                "계정·이메일 검증 정보",
                "계정 이용 중 보유합니다. 계정 삭제 요청 처리 시 삭제하며, 기기 등록 해제만으로 계정·TURN 설정까지 모두 삭제되지는 않습니다."
              ],
              [
                "기기·초대·연결 기록",
                "기기 관리와 연결 복구를 위해 보유합니다. 기기 등록 해제 시 관련 초대·세션을 삭제합니다. 일회용 초대는 1시간 내 사용 가능하고, 상시 링크는 회수 전까지 유효합니다. 만료·사용된 초대의 저장 레코드는 후속 정리 시 삭제될 수 있습니다."
              ],
              [
                "Google 로그인 상태(해당 기능 이용 시)",
                "로그인 준비 정보는 최대 10분, 앱 로그인 세션은 최대 7일 동안 유효합니다. 로그아웃은 해당 세션을 폐기합니다. 만료 레코드는 다음 로그인 정리 시 삭제되므로 유효기간과 물리적 삭제 시점은 다를 수 있습니다."
              ],
              [
                "TURN 자격 증명",
                "등록 설정은 이용자가 삭제하거나 계정 삭제를 요청할 때까지 암호화해 보관합니다. 임시 자격 증명은 통상 24시간 유효하며 만료·설정 삭제·재발급 과정에서 정리합니다."
              ],
              [
                "브라우저·Mac의 로컬 정보",
                "브라우저의 언어·키 매핑은 사이트 데이터 삭제 시까지, 세션 복구 정보는 연결 종료·탭 세션 종료 시까지 보관될 수 있습니다. Mac의 연결 키·상태·로그는 이용자가 해당 로컬 파일을 삭제할 때까지 남을 수 있으며 앱 제거만으로 지워지지 않을 수 있습니다."
              ],
              [
                "문의·분쟁·법정 보존 정보",
                "문의 해결에 필요한 기간 보유하고 목적 달성 후 지체 없이 삭제합니다. 법령상 보존 의무나 적법한 분쟁 대응상 보존 사유가 있으면 해당 항목·근거·기간을 요청자에게 안내하고 필요한 범위로 분리·제한합니다."
              ]
            ]
          }
        },
        {
          "id": "destruction",
          "title": "6. 파기 절차",
          "paragraphs": [
            "보유 목적이 끝나거나 적법한 삭제 요청이 확인되면 해당 계정·기기와 연결된 데이터의 범위를 확인해 데이터베이스·파일 저장소에서 삭제합니다. 전자파일은 통상적인 방법으로 복구·재생할 수 없도록 삭제하고, 종이 문서가 있는 경우 파쇄 등으로 파기합니다.",
            "호스팅 제공자의 백업·보안 로그·법정 보존 정보에는 제공자의 계약·정책 또는 법령상 별도 기간이 적용될 수 있습니다. 확인되지 않은 백업 삭제 시점이나 보관 기간을 즉시 삭제로 안내하지 않습니다."
          ]
        },
        {
          "id": "sharing",
          "title": "7. 접속자에게 공개되는 정보와 외부 서비스",
          "paragraphs": [
            "소유자가 초대를 공유하면 초대받은 사람은 허용된 범위의 화면·기기 이름·연결 상태를 확인하고, 제어 권한이 있으면 기기를 조작할 수 있습니다. 호스트 이메일 확인은 추가 인증이나 2단계 인증이 아닙니다. 상시 링크를 공유한 경우 매번 소유자 승인을 받지 않을 수 있습니다.",
            "개인정보를 판매하거나 광고업체에 제공하지 않습니다. 요청한 연결·로그인·호스팅의 제공에 필요한 처리, 이용자가 별도로 동의한 처리, 법률상 의무에 따른 처리를 제외하고 목적 외 제3자 제공을 하지 않습니다."
          ],
          "table": {
            "headers": [
              "제공자·역할",
              "처리 범위·문의"
            ],
            "rows": [
              [
                "Google LLC — Google 인증 기능 이용 시",
                "계정 인증과 기본 프로필 확인. 문의·삭제 권리는 Google 개인정보처리방침과 계정 관리에서도 행사할 수 있습니다."
              ],
              [
                "OpenAI — Sites 호스팅",
                "웹사이트 제공, 요청 처리·보안. MacLink가 화면·입력을 AI 모델에 보내는 기능을 제공한다는 뜻은 아닙니다. 문의: OpenAI Privacy Portal."
              ],
              [
                "Cloudflare, Inc. — 호스팅 기반·저장소·네트워크 보안·STUN/TURN",
                "서비스 요청, 데이터 저장·전송 및 선택적 중계. 중계 계정을 직접 등록하면 해당 제공자 계약도 적용됩니다. 문의: privacyquestions@cloudflare.com."
              ]
            ]
          },
          "links": [
            {
              "label": "Google 개인정보처리방침",
              "href": "https://policies.google.com/privacy"
            },
            {
              "label": "OpenAI 개인정보처리방침·문의",
              "href": "https://openai.com/policies/row-privacy-policy/"
            },
            {
              "label": "Cloudflare 개인정보처리방침",
              "href": "https://www.cloudflare.com/privacypolicy/"
            }
          ]
        },
        {
          "id": "international",
          "title": "8. 국외 처리",
          "paragraphs": [
            "위 제공자는 미국 소재 사업자를 포함하며 글로벌 인프라를 운영합니다. 로그인·사이트 이용·중계 연결 시 필요한 정보가 암호화된 네트워크로 전송되어 미국 및 제공자가 공개한 해외 처리 지역에서 처리될 수 있습니다. 대한민국 내 한정 저장 서비스는 제공하지 않습니다.",
            "국외에서 처리되는 항목·목적·보유 기준은 위 표와 각 제공자의 정책을 함께 확인하세요. 실제 개별 데이터센터 국가와 공급자별 백업·보안 로그 보관 기간은 MacLink가 현재 고정해 보장하는 정보가 아니므로, 구체적 확인은 담당자에게 요청할 수 있습니다. 법령에 따라 필요한 추가 고지나 별도 동의가 있는 경우 그 절차를 따릅니다.",
            "국외 처리를 원하지 않으면 해당 로그인·호스팅·중계 기능의 사용을 중단하고 계정·기기 삭제를 요청할 수 있습니다. 서비스 제공에 필요한 처리를 거부하면 해당 기능을 이용하지 못할 수 있습니다."
          ]
        },
        {
          "id": "cookies",
          "title": "9. 쿠키와 브라우저 저장소",
          "paragraphs": [
            "로그인 유지·인증 요청 보호에 필요한 쿠키, 언어와 키보드 매핑을 위한 로컬 저장소, 현재 연결을 복구하기 위한 탭 세션 저장소를 사용합니다. Google 로그인을 사용할 때 앱의 로그인 쿠키는 최대 7일, 인증 준비 쿠키는 최대 10분 동안 유효하며 HttpOnly·SameSite 등 보호 속성을 적용합니다.",
            "호스팅·인증 제공자의 필수 보안 쿠키가 추가될 수 있습니다. 현재 MacLink 애플리케이션에는 광고 추적이나 별도의 방문 분석 SDK를 넣지 않습니다. 인프라 제공자의 보안·운영 정보 처리는 해당 제공자의 정책에 따릅니다.",
            "브라우저 설정에서 쿠키를 차단하거나 사이트 데이터를 삭제할 수 있습니다. 이 경우 로그인이 풀리거나 저장한 설정·연결 복구 정보가 사라질 수 있습니다."
          ]
        },
        {
          "id": "google",
          "title": "10. Google 사용자 정보의 이용",
          "paragraphs": [
            "Google 로그인이 활성화된 경우 openid·email·profile 범위에서 기본 계정 식별자·이메일·이름을 받아 로그인과 기기 소유자 확인에 사용합니다. Google 비밀번호를 받지 않으며 Gmail·Drive·Calendar 내용에 대한 접근 권한을 요청하지 않습니다.",
            "Google API로 받은 정보는 Google API Services User Data Policy와 적용되는 Limited Use 요구사항을 준수해 이용·전송합니다. 이를 광고, 판매, 신용평가 또는 범용 AI 모델 학습에 사용하지 않습니다.",
            "Google 계정에서 MacLink 연결 권한을 철회할 수 있습니다. Google에서 연결을 해제하는 것만으로 MacLink가 이미 보관한 계정·기기 데이터가 모두 삭제되는 것은 아니므로, 해당 데이터의 삭제는 담당자에게 별도로 요청하세요."
          ],
          "links": [
            {
              "label": "Google API Services User Data Policy",
              "href": "https://developers.google.com/terms/api-services-user-data-policy"
            }
          ]
        },
        {
          "id": "rights",
          "title": "11. 이용자의 권리와 행사 방법",
          "paragraphs": [
            "이용자와 법정대리인은 관련 법령에 따라 개인정보 열람·정정·삭제·처리정지, 동의 철회, 계정 삭제를 요청할 수 있습니다. taoss3932@gmail.com로 요청 종류와 확인 가능한 계정 정보를 보내주세요. 필요한 최소한의 본인 확인 후 법령에 따라 지체 없이 처리하고 결과 또는 제한 사유를 안내합니다.",
            "비밀번호, 연결 키 원문, 초대 링크의 비밀 값, 신분증 전체 사본이나 민감한 화면을 공개 게시판에 올리지 마세요. 확인 자료가 더 필요하면 담당자가 안전한 제출 방법을 개별 안내합니다.",
            "즉시 접근을 중단하려면 커넥터를 멈추고, 내 기기의 접속 권한을 회수하거나 등록을 해제하세요. 계정·모든 잔여 정보 삭제는 담당자에게 별도로 요청할 수 있습니다.",
            "권리 침해에 관한 신고·상담이나 분쟁조정은 개인정보 포털의 공식 안내를 이용할 수 있습니다."
          ],
          "links": [
            {
              "label": "개인정보 포털",
              "href": "https://www.privacy.go.kr/"
            }
          ]
        },
        {
          "id": "security",
          "title": "12. 안전조치·아동·변경 안내",
          "paragraphs": [
            "통신 암호화, 소유자·연결 키 기반 접근 통제, 비밀 값의 해시 보관, TURN 설정의 암호화, 입력 값 검증과 세션 권한 확인을 적용합니다. 모든 경로의 무위험이나 보안 사고가 절대 발생하지 않음을 보장하지는 않습니다.",
            "MacLink는 만 14세 미만 아동을 대상으로 제공하지 않으며 이를 알게 된 경우 필요한 보호·삭제 조치를 합니다. 생년월일이나 신분증을 상시 수집하는 연령 인증 기능을 제공하는 것은 아닙니다.",
            "개인정보 처리 목적·항목·제공자·권리 행사 방법 등이 변경되면 이 페이지에 시행일과 내용을 공개하고, 중요한 변경이나 법령상 고지·동의가 필요한 경우 별도 안내합니다. 이 방침의 최초 시행일은 2026년 10월 17일입니다."
          ]
        }
      ]
    },
    "en": {
      "title": "Privacy Policy",
      "subtitle": "How MacLink processes information and carries screen and remote input.",
      "summary": [
        "Screens and remote input use direct WebRTC or encrypted TURN relaying. MacLink does not upload or store screen/input payloads on the website.",
        "Email is used for account and device verification, not advertising profiles or AI model training.",
        "Removing a device is different from deleting an account. Contact the operator to request account deletion."
      ],
      "sections": [
        {
          "id": "operator",
          "title": "1. Operator and scope",
          "paragraphs": [
            "MacLink is a remote screen sharing and device control service operated by 오종현. This policy covers the operator’s processing through https://www.maclink.cloud and the MacLink Connector.",
            "Privacy contact and person responsible: 오종현. Requests, complaints, access, correction, deletion, restriction and consent withdrawal: taoss3932@gmail.com.",
            "Device owners sign in with Google. Google authentication is also governed by Google policies. Rights requests and deletion rules in this policy also cover any retained account/device records from the previous service."
          ]
        },
        {
          "id": "collection",
          "title": "2. Information and purposes",
          "table": {
            "headers": [
              "Category",
              "Information",
              "Purpose"
            ],
            "rows": [
              [
                "Account authentication",
                "Provider account identifier, email and supplied display name; for Google, the Google subject identifier and email verification status",
                "Sign-in, account ownership, device management and verification of requests"
              ],
              [
                "Device management",
                "Device name and ID, connector-key hash, app version, screen/input permission status, connectivity and last-seen time",
                "Connector authentication and device availability"
              ],
              [
                "Invitations and sessions",
                "Invitation/session IDs, secret hashes, host-email verification hash, permissions, status/timestamps/end reasons, quality settings and WebRTC SDP/ICE information that may include IP addresses and ports",
                "Invitation verification, connection negotiation, revocation, recovery and diagnostics"
              ],
              [
                "Screens and remote input",
                "The shared display, pointer coordinates/clicks/wheel, key events and text explicitly submitted",
                "Authorized screen sharing and remote interaction"
              ],
              [
                "Optional TURN configuration",
                "User-supplied Cloudflare TURN key ID/API token and temporary relay credentials",
                "Relay connectivity when direct connections fail"
              ],
              [
                "Settings, security and support",
                "Language/key mappings, current session recovery information, infrastructure request metadata such as IP/time/browser, and information users send in support emails or reports",
                "Preferences, recovery, security and support"
              ]
            ]
          }
        },
        {
          "id": "basis",
          "title": "3. Sources and basis",
          "paragraphs": [
            "Data comes from identity responses, user registration/settings/support requests, Connector status reports, remote connections and browser/hosting operations. Necessary account and connection processing supports the service requested by the user.",
            "Where consent is required for optional information or a new purpose, the relevant purpose, information and retention will be explained and the required consent obtained. Security and abuse prevention use the minimum necessary information within applicable law.",
            "Declining required sign-in or connection information can prevent device registration or remote access. Invited visitors do not need an owner account. TURN configuration and support attachments are optional."
          ]
        },
        {
          "id": "transport",
          "title": "4. Remote screen and input processing",
          "paragraphs": [
            "With direct WebRTC, encrypted communication carries screens and input between the host and visitor. With TURN, the relay provider processes encrypted packets and connection metadata.",
            "Screens and keyboard, pointer and text-send contents travel only over WebRTC media/data channels. No HTTPS screen/input fallback or server API that accepts and stores these payloads is provided. HTTPS protects the website, sign-in, authorization and connection signaling.",
            "Documents, notifications, accounts and sensitive information visible on the shared screen may be seen by the visitor. Close unnecessary windows and confirm your authority to share others’ information. Audio streaming, dedicated file transfer and screen recording are not currently provided.",
            "The operator does not use remote screens or input for advertising, sale, user profiling or AI model training. Any access needed for support, security or legal obligations is limited to a necessary scope and lawful basis."
          ]
        },
        {
          "id": "retention",
          "title": "5. Retention",
          "table": {
            "headers": [
              "Information",
              "Retention and cleanup"
            ],
            "rows": [
              [
                "Account and email verification data",
                "Retained while the account is used and deleted when an account-deletion request is processed. Device removal does not by itself remove all account or TURN data."
              ],
              [
                "Devices, invitations and sessions",
                "Retained for device management and recovery. Device removal deletes its related invitations/sessions. Single-use invitations are usable for one hour; reusable links remain valid until revoked. Expired or used invitation records may be removed during later cleanup."
              ],
              [
                "Google sign-in, when used",
                "Login transactions are valid for up to 10 minutes and app sessions for up to seven days. Logout revokes that session. Expired database records are removed during later sign-in cleanup; validity and physical deletion are different."
              ],
              [
                "TURN credentials",
                "Registered settings are encrypted until removed or account deletion is requested. Temporary credentials normally last 24 hours and are cleaned up on expiry, configuration removal or renewal."
              ],
              [
                "Local browser/Mac data",
                "Language and key mappings can remain until browser site data is cleared. Session recovery data can remain until the connection/tab session ends. Local keys, status and logs on a Mac may remain until the user deletes the files; uninstalling the app may not remove them."
              ],
              [
                "Support and legally retained information",
                "Retained as necessary to resolve a request, then deleted without undue delay. Legally required retention or legitimate dispute preservation is limited to necessary information; applicable grounds and periods are explained to the requester."
              ]
            ]
          }
        },
        {
          "id": "destruction",
          "title": "6. Deletion",
          "paragraphs": [
            "When a purpose ends or a valid deletion request is verified, related account/device data is identified and deleted from the database and file storage. Electronic records are deleted so they cannot ordinarily be recovered or replayed; any paper records are destroyed appropriately.",
            "Provider backups, security logs and legally retained records may follow separate contractual, provider or legal periods. MacLink does not promise an unverified backup deletion deadline."
          ]
        },
        {
          "id": "sharing",
          "title": "7. Visitors and service providers",
          "paragraphs": [
            "When an owner shares an invitation, the invited visitor can see the authorized screen, device name and connection state, and can operate the device if control is permitted. Knowing the host email is not a second authentication factor. A reusable invitation may allow connections without approval each time.",
            "MacLink does not sell personal data or provide it to advertisers. Disclosure is limited to requested connectivity/authentication/hosting, separately authorized purposes and legal obligations."
          ],
          "table": {
            "headers": [
              "Provider and role",
              "Processing and contact"
            ],
            "rows": [
              [
                "Google LLC — when Google sign-in is used",
                "Authentication and basic identity. Google’s privacy policy and account controls also apply."
              ],
              [
                "OpenAI — Sites hosting",
                "Website delivery, request processing and security. MacLink does not provide a feature that sends screen/input contents to an AI model. Contact: OpenAI Privacy Portal."
              ],
              [
                "Cloudflare, Inc. — hosting infrastructure, storage, security and STUN/TURN",
                "Requests, storage/transport and optional relay services. User-managed relay accounts also follow the provider agreement. Contact: privacyquestions@cloudflare.com."
              ]
            ]
          },
          "links": [
            {
              "label": "Google Privacy Policy",
              "href": "https://policies.google.com/privacy"
            },
            {
              "label": "OpenAI Privacy Policy and contact",
              "href": "https://openai.com/policies/row-privacy-policy/"
            },
            {
              "label": "Cloudflare Privacy Policy",
              "href": "https://www.cloudflare.com/privacypolicy/"
            }
          ]
        },
        {
          "id": "international",
          "title": "8. International processing",
          "paragraphs": [
            "Providers include US-based organizations with global infrastructure. When you sign in, use the site or connect through a relay, necessary data may be transmitted over encrypted networks and processed in the United States and other processing locations published by the providers. MacLink does not offer storage confined to the Republic of Korea.",
            "Read the categories, purposes and retention criteria above together with the providers’ policies. MacLink cannot currently guarantee a fixed country for each data center or a specific provider backup/security-log period; ask the privacy contact for case-specific details. Any additional notice or separate consent required by law will be provided.",
            "You can decline such processing by stopping the relevant sign-in/hosting/relay features and requesting account/device deletion. Refusing processing required to deliver a feature can make that feature unavailable."
          ]
        },
        {
          "id": "cookies",
          "title": "9. Cookies and local storage",
          "paragraphs": [
            "Necessary cookies protect authentication and maintain sign-in. Local storage retains language/key mappings and tab session storage supports recovery. When Google sign-in is used, app session cookies last up to seven days and authentication transaction cookies up to ten minutes, with protections including HttpOnly and SameSite.",
            "Hosting/authentication providers may add security cookies. The MacLink application currently includes no advertising trackers or separate visitor analytics SDK. Infrastructure security and operational processing follow the providers’ policies.",
            "Browser controls let you block cookies or clear site data. This can sign you out or remove preferences and recovery information."
          ]
        },
        {
          "id": "google",
          "title": "10. Google information",
          "paragraphs": [
            "When enabled, Google sign-in requests only openid, email and profile to identify the account and its device ownership. MacLink does not receive your Google password or request Gmail, Drive or Calendar contents.",
            "Use and transfer of information received through Google APIs comply with the Google API Services User Data Policy, including applicable Limited Use requirements. This information is not used for advertising, sale, credit decisions or general-purpose AI training.",
            "You may revoke MacLink access in your Google Account. Revoking the connection there does not automatically erase all information already retained by MacLink; contact the operator to request deletion."
          ],
          "links": [
            {
              "label": "Google API Services User Data Policy",
              "href": "https://developers.google.com/terms/api-services-user-data-policy"
            }
          ]
        },
        {
          "id": "rights",
          "title": "11. Your rights",
          "paragraphs": [
            "Users and legal representatives can request access, correction, deletion, restriction, consent withdrawal or account deletion as provided by applicable law. Email taoss3932@gmail.com with the request and sufficient account information. After minimum necessary identity verification, we respond without undue delay as required by law and explain any limitation.",
            "Do not post passwords, raw connector keys, secret invitation values, full identity documents or sensitive screens in public issues. If further evidence is required, the contact will explain an appropriate submission method.",
            "To stop access immediately, stop the Connector, revoke invitations or remove the device. Request account and residual information deletion separately from the privacy contact.",
            "The Korean Privacy Portal provides official information about privacy complaints and dispute resolution."
          ],
          "links": [
            {
              "label": "Korean Privacy Portal",
              "href": "https://www.privacy.go.kr/"
            }
          ]
        },
        {
          "id": "security",
          "title": "12. Safeguards, children and changes",
          "paragraphs": [
            "Safeguards include encrypted transport, owner/key-based authorization, secret hashing, encrypted TURN settings, input validation and session-permission checks. No system can guarantee complete freedom from security incidents.",
            "MacLink is not directed to children under 14. If such use becomes known, appropriate protection and deletion measures will be taken. This does not mean that the service continuously collects dates of birth or identity documents to verify age.",
            "Changes to purposes, information, providers or rights are published here with an effective date. Material changes or changes requiring notice/consent receive the required separate communication. This policy first takes effect on October 17, 2026."
          ]
        }
      ]
    }
  },
  "terms": {
    "ko": {
      "title": "서비스 약관",
      "subtitle": "내 기기를 연결하고 다른 사람을 초대할 때 지켜야 할 이용 조건입니다.",
      "summary": [
        "자신의 기기 또는 명시적으로 권한을 받은 기기에만 접속하세요.",
        "상시 초대 링크는 반복 접속 권한입니다. 링크와 연결 키를 비밀로 보관하세요.",
        "현재 서비스는 무료이며 PayPal 결제와 후원 결제는 지원하지 않습니다."
      ],
      "sections": [
        {
          "id": "purpose",
          "title": "1. 목적과 운영자",
          "paragraphs": [
            "이 약관은 오종현(이하 “운영자”)이 제공하는 MacLink 웹사이트와 커넥터를 통한 원격 화면 공유·기기 제어 서비스의 이용 조건을 정합니다. 서비스 주소는 https://www.maclink.cloud이며 문의처는 taoss3932@gmail.com입니다.",
            "“소유자”는 기기를 등록하고 접근을 허용하는 사람, “접속자”는 초대를 통해 해당 기기에 접속하는 사람입니다. 운영자와 이용자는 적용되는 법령 및 이 약관을 준수합니다."
          ]
        },
        {
          "id": "eligibility",
          "title": "2. 이용과 계정",
          "paragraphs": [
            "서비스는 만 14세 이상을 대상으로 합니다. 미성년자가 법률상 필요한 법정대리인 동의를 받아야 하는 경우에는 이를 갖추어야 합니다. 이용계약의 성립과 중요한 동의는 서비스에서 제공하는 명시적 신청·동의 절차에 따릅니다.",
            "소유자는 로그인 화면에 제공되는 계정 인증을 이용하고, 관리 권한이 있는 기기만 등록해야 합니다. 허위 신원, 타인의 계정·기기·연결 키를 이용한 등록을 해서는 안 됩니다. 초대받은 접속자는 별도 소유자 계정 없이 접속할 수 있습니다.",
            "계정 인증 정보, 다운로드한 연결 키, 초대 링크와 세션 정보는 안전하게 보관하세요. 유출이 의심되면 즉시 접속 권한을 회수하고 필요한 경우 기기를 다시 등록하세요. 이용자에게 책임이 없는 사고까지 이용자에게 일괄 전가하지 않습니다."
          ]
        },
        {
          "id": "service",
          "title": "3. 제공 기능과 이용 환경",
          "paragraphs": [
            "MacLink는 켜져 있는 Mac의 화면 공유와 허용된 키보드·마우스 제어를 제공합니다. WebRTC 직접 연결과 선택적 TURN 중계를 사용합니다. 두 경로가 모두 차단되면 연결되지 않습니다. 웹사이트·로그인·API는 HTTPS를 사용합니다.",
            "현재 기본 디스플레이 한 대와 동시 접속자 한 명을 지원합니다. 오디오 송출, 전용 파일 전송, 잠자기 중 깨우기, 부팅 전 FileVault·로그인 화면 제어 등은 제공하거나 보장하지 않습니다.",
            "소유자는 필요한 macOS 권한을 직접 허용하고 인터넷·전원·잠자기 설정을 관리해야 합니다. 실제 해상도·프레임 수·지연·연결 성공은 Mac 성능, 네트워크, 브라우저 및 중계 제공자의 상태에 영향을 받습니다."
          ]
        },
        {
          "id": "permission",
          "title": "4. 원격 접속 권한과 공유 책임",
          "paragraphs": [
            "소유자는 보기 전용 또는 제어 권한을 선택하고, 허용할 사람에게만 초대를 전달해야 합니다. 일회용 초대는 유효기간·승인 조건에 따르며, 상시 링크는 회수 전까지 반복 접속 권한을 부여할 수 있습니다. 매 연결마다 별도 승인을 받는다고 가정하지 마세요.",
            "호스트 이메일 확인은 추가 인증이나 2단계 인증이 아닙니다. 링크·이메일·연결 키를 공개 게시하거나 신뢰할 수 없는 사람에게 보내지 마세요. 권한을 받은 접속자도 허용 목적·범위를 넘어 기기나 정보에 접근해서는 안 됩니다.",
            "제3자의 문서·개인정보·업무 자료를 공유할 때에는 필요한 권한과 법적 근거를 갖추고, 불필요한 창과 알림을 닫으세요. 접속자의 복사·별도 촬영·저장을 기술적으로 모두 막을 수는 없습니다."
          ]
        },
        {
          "id": "prohibited",
          "title": "5. 금지 행위",
          "bullets": [
            "권한 없는 기기 접속, 도용한 계정·연결 키·초대의 사용, 권한 확인 우회 또는 접근 권한 확대",
            "동의 없는 감시·스토킹·사생활 침해, 사기, 악성코드 배포, 불법 자료 처리, 타인의 권리 침해",
            "기기의 파일·데이터를 허락 없이 열람·변경·삭제하거나 접속을 방해하는 행위",
            "과도한 자동 요청, 서비스 거부 공격, 비밀 값 추측, 서비스의 정상 운영과 보안을 해치는 행위",
            "법령·본 약관·해당 소프트웨어 라이선스에 위반하는 이용"
          ]
        },
        {
          "id": "fees",
          "title": "6. 요금과 외부 비용",
          "paragraphs": [
            "현재 운영자가 제공하는 서비스 이용료는 무료입니다. 커넥터의 후원 버튼은 안내용이며 PayPal 결제·후원금 결제를 처리하지 않습니다. 결제 정보나 청구서를 제출하도록 요구하지 않습니다.",
            "인터넷 이용료, 이용자가 직접 가입한 Cloudflare TURN·호스팅 등 외부 서비스 비용은 해당 제공자의 계약에 따릅니다. 유료 기능을 도입하는 경우에는 요금·제공 조건·해지·환불 조건을 먼저 안내하고 필요한 동의를 받습니다."
          ]
        },
        {
          "id": "privacy",
          "title": "7. 개인정보와 데이터",
          "paragraphs": [
            "개인정보의 항목·목적·보관·제공자·국외 처리·권리 행사 방법은 개인정보 처리방침을 따릅니다. 서비스 제공에 필요한 범위를 넘어 데이터의 소유권을 양도하거나 광고·AI 학습 등 포괄적 이용권을 운영자에게 부여하는 것은 아닙니다.",
            "MacLink 서버에 원격 화면과 입력 내용을 업로드·저장하는 보조 중계를 제공하지 않습니다. 접속자가 별도 도구로 화면을 저장하는 행위를 기술적으로 모두 막을 수는 없습니다. 중요 자료는 이용자가 별도로 백업해야 합니다."
          ],
          "links": [
            {
              "label": "개인정보 처리방침",
              "href": "/privacy"
            }
          ]
        },
        {
          "id": "rights",
          "title": "8. 소프트웨어와 지식재산권",
          "paragraphs": [
            "이용자의 자료에 관한 권리는 이용자 또는 정당한 권리자에게 남습니다. MacLink 코드·문서·자산 및 외부 구성요소에는 저장소에 표시된 각 라이선스와 권리 고지가 적용됩니다.",
            "MacLink 원본 소프트웨어에는 현재 출처 표시와 비상업적 이용 조건을 둔 라이선스가 적용됩니다. 영리 이용 등 허용 범위를 넘는 이용은 권리자의 별도 허가가 필요합니다. 이 서비스 약관이 해당 라이선스나 외부 구성요소가 부여하는 권리를 임의로 변경하는 것은 아닙니다."
          ],
          "links": [
            {
              "label": "저장소와 라이선스",
              "href": "https://github.com/fivebellhyun/MacLink#license"
            }
          ]
        },
        {
          "id": "end",
          "title": "9. 중단·탈퇴·이용 제한",
          "paragraphs": [
            "접속자는 연결을 종료할 수 있고, 소유자는 커넥터 중지, 초대 권한 회수 또는 기기 등록 해제로 접근을 차단할 수 있습니다. 계정·잔여 정보 삭제는 운영자에게 요청할 수 있습니다. 연결 중지나 앱 제거만으로 모든 계정 정보가 삭제되는 것은 아닙니다.",
            "법령 위반, 권한 없는 접근, 명백한 보안 위험 또는 운영 방해가 확인되면 필요한 범위에서 해당 연결이나 계정 이용을 제한할 수 있습니다. 긴급 조치가 필요한 경우를 제외하고 사유를 안내하며, 이용자는 문의처를 통해 이의를 제기할 수 있습니다.",
            "점검·장애·외부 서비스 문제·보안 대응으로 서비스가 일시 중단될 수 있습니다. 예정된 중요한 변경·종료는 가능한 한 사전에 이유와 영향을 안내하고, 긴급 중단은 사후 지체 없이 알립니다. 정당한 사유 없이 이용자에게 부당한 불이익을 주는 중단은 하지 않습니다."
          ]
        },
        {
          "id": "liability",
          "title": "10. 책임과 한계",
          "paragraphs": [
            "운영자는 안정성과 보안을 위해 필요한 조치를 하되, 중단 없는 접속, 특정 네트워크에서의 연결, 일정한 화질·속도 또는 모든 기기·브라우저의 호환을 보장하지 않습니다. 별도 약정이 없는 상업용 지원 SLA는 제공하지 않습니다.",
            "손해 발생 시 운영자와 이용자의 책임은 귀책 사유, 인과관계, 예견 가능성 등 관련 법령에 따라 판단합니다. 운영자·이행보조자의 고의 또는 중대한 과실에 따른 책임이나 법률상 배제할 수 없는 책임을 면제하지 않습니다.",
            "무료 서비스라는 이유만으로 운영자의 모든 책임이 사라지거나, 모든 위험·입증 책임을 이용자가 부담하는 것은 아닙니다. 이용자에게 법률이 보장한 구제·해지·손해배상 권리는 유지됩니다."
          ]
        },
        {
          "id": "changes",
          "title": "11. 약관 변경과 안내",
          "paragraphs": [
            "약관을 변경하면 시행일·변경 내용·사유를 이 페이지 또는 서비스 공지로 알립니다. 통상 변경은 원칙적으로 시행 7일 전, 이용자에게 불리하거나 중요한 변경은 원칙적으로 30일 전에 안내합니다. 법령이나 긴급한 보안상 필요가 있는 경우에는 그 사유에 맞는 방법으로 알립니다.",
            "별도 동의가 필요한 중요한 변경에는 필요한 동의 절차를 적용합니다. 단순히 답하지 않거나 서비스를 계속 이용했다는 이유만으로 법률이 요구하는 동의가 있었다고 일괄 간주하지 않습니다. 동의하지 않는 이용자는 이용을 중단하고 탈퇴·삭제를 요청할 수 있습니다."
          ]
        },
        {
          "id": "law",
          "title": "12. 준거법·분쟁·시행일",
          "paragraphs": [
            "이 약관에는 대한민국 법률을 적용합니다. 다만 이용자에게 적용되는 강행 법규와 법률상 소비자 권리를 배제하지 않습니다. 분쟁은 우선 문의처를 통해 협의하고, 해결되지 않으면 관계 법령이 정한 관할 법원이나 분쟁조정 절차에 따릅니다. 특정 법원만을 이용자에게 부당하게 강제하지 않습니다.",
            "한·영 문서는 같은 내용을 안내하기 위한 것이며, 해석 차이가 있으면 대한민국 법률이 허용하는 범위에서 한국어 문서를 기준으로 합니다. 일부 조항이 무효여도 나머지 유효한 조항은 유지됩니다. 이 약관의 최초 시행일은 2026년 10월 17일입니다.",
            "운영자: 오종현 · 서비스 및 약관 문의: taoss3932@gmail.com."
          ]
        }
      ]
    },
    "en": {
      "title": "Terms of Service",
      "subtitle": "Conditions for connecting your Mac and inviting another person to access it.",
      "summary": [
        "Access only devices you own or are expressly authorized to access.",
        "Reusable invitations grant repeat access. Keep invitation links and connector keys secret.",
        "The service is currently free. PayPal payments and paid donations are not enabled."
      ],
      "sections": [
        {
          "id": "purpose",
          "title": "1. Service and operator",
          "paragraphs": [
            "These terms govern the remote screen-sharing and device-control service provided through the MacLink website and Connector by 오종현 (the “operator”). The service is at https://www.maclink.cloud. Contact: taoss3932@gmail.com.",
            "An “owner” registers a device and authorizes access. A “visitor” connects through an invitation. The operator and users must comply with applicable law and these terms."
          ]
        },
        {
          "id": "eligibility",
          "title": "2. Eligibility and accounts",
          "paragraphs": [
            "The service is intended for users aged 14 or older. A minor must obtain any legal-representative consent required by applicable law. Contract formation and important consents follow explicit application/consent processes provided by the service.",
            "Owners use the identity provider offered on the sign-in screen and may register only devices they are authorized to manage. False identities, another person’s account or stolen device keys must not be used. Invited visitors do not need a separate owner account.",
            "Protect account credentials, downloaded keys, invitations and session information. If exposure is suspected, revoke access and re-register the device when necessary. These terms do not shift liability for incidents outside a user’s responsibility onto that user."
          ]
        },
        {
          "id": "service",
          "title": "3. Features and requirements",
          "paragraphs": [
            "MacLink shares the screen and authorized keyboard/pointer control of an online Mac over direct WebRTC or optional TURN. Connections fail where both paths are blocked. The website, sign-in and API use HTTPS.",
            "The service currently supports one primary display and one concurrent visitor per Mac. Audio streaming, dedicated file transfer, waking sleeping Macs and pre-boot FileVault/login-screen control are not provided or guaranteed.",
            "Owners manage macOS permissions, connectivity, power and sleep settings. Actual resolution, frame rate, latency and connection success depend on hardware, networks, browsers and relay availability."
          ]
        },
        {
          "id": "permission",
          "title": "4. Invitations and authority",
          "paragraphs": [
            "Owners choose view-only or control permissions and share invitations only with authorized people. Single-use invitations follow their expiry/approval conditions. Reusable links can authorize repeat access until revoked; do not assume that each connection needs a fresh approval.",
            "Host-email verification is not a second authentication factor. Do not publish secret links or keys or share them with untrusted people. Visitors must remain within the authorized purpose and scope.",
            "Before sharing others’ documents, personal information or work materials, obtain the necessary authority and lawful basis and close unnecessary windows/notifications. MacLink cannot prevent every copy, independent recording or capture by an authorized visitor."
          ]
        },
        {
          "id": "prohibited",
          "title": "5. Prohibited use",
          "bullets": [
            "Unauthorized device access, stolen credentials/invitations, bypassing authorization or escalating permissions",
            "Non-consensual surveillance, stalking, privacy violations, fraud, malware, unlawful materials or infringement of others’ rights",
            "Viewing, altering or deleting device information without permission or disrupting authorized access",
            "Abusive automation, denial-of-service attacks, secret guessing or interference with service security and operation",
            "Use contrary to applicable law, these terms or the relevant software license"
          ]
        },
        {
          "id": "fees",
          "title": "6. Charges and third-party costs",
          "paragraphs": [
            "The operator currently charges no service fee. Connector support buttons are informational; PayPal payments and paid donations are not processed. No payment-card or billing information is requested for this free service.",
            "Internet access and user-managed services such as Cloudflare TURN or hosting follow the respective provider contracts. Any future paid feature requires advance information about charges, service, cancellation and refunds and the necessary agreement."
          ]
        },
        {
          "id": "privacy",
          "title": "7. Personal data and user content",
          "paragraphs": [
            "The Privacy Policy explains information, purposes, retention, providers, international processing and rights. Providing the service does not transfer ownership of user content or grant a broad license for advertising or AI training.",
            "MacLink provides no fallback that uploads or stores remote screen/input contents on its server. It cannot prevent a remote guest from recording the screen with separate tools. Maintain separate backups of important information."
          ],
          "links": [
            {
              "label": "Privacy Policy",
              "href": "/privacy?lang=en"
            }
          ]
        },
        {
          "id": "rights",
          "title": "8. Intellectual property and licensing",
          "paragraphs": [
            "User content remains with the user or its lawful rights holder. MacLink source, documentation, assets and third-party components follow the licenses and notices in the repository.",
            "The original MacLink software currently has attribution and noncommercial-use conditions. Use beyond the granted scope, including commercial use, needs separate permission from the rights holder. These service terms do not replace those licenses or remove rights separately granted by third-party licenses."
          ],
          "links": [
            {
              "label": "Repository and license",
              "href": "https://github.com/fivebellhyun/MacLink#license"
            }
          ]
        },
        {
          "id": "end",
          "title": "9. Ending access and service restrictions",
          "paragraphs": [
            "Visitors may end a connection. Owners may stop the Connector, revoke invitations or remove a device. Ask the operator to delete the account and residual information. Stopping or uninstalling the app does not itself delete all account data.",
            "A connection or account may be restricted to the extent necessary for unlawful access, clear security risk or operational abuse. Reasons are provided unless urgent action is necessary; users may challenge the action through the contact address.",
            "Maintenance, outages, provider failures or security response can interrupt service. Planned material changes/closure are announced with reasons and effects as early as reasonably possible; urgent interruptions are explained without undue delay afterwards. Restrictions must not unfairly disadvantage users without a valid reason."
          ]
        },
        {
          "id": "liability",
          "title": "10. Responsibility and limitations",
          "paragraphs": [
            "The operator takes appropriate steps for stability and security but does not promise uninterrupted access, connectivity in every network, a fixed quality/speed or compatibility with every device/browser. No commercial support SLA is provided without a separate agreement.",
            "Responsibility for loss follows applicable law, including fault, causation and foreseeability. Liability for the operator’s or service assistants’ intentional misconduct or gross negligence, and any liability that law does not allow to be excluded, is not excluded.",
            "A free service does not automatically remove all operator liability or place every risk and burden of proof on the user. Statutory remedies, termination rights and compensation rights remain available."
          ]
        },
        {
          "id": "changes",
          "title": "11. Changes to these terms",
          "paragraphs": [
            "Changes are announced here or through service notices with their effective date, content and reasons. Normally, notice is given at least seven days in advance, or 30 days for material or unfavorable changes. Legal requirements or urgent security needs are communicated appropriately.",
            "Where a material change requires separate consent, the necessary consent process applies. Silence or continued use is not automatically treated as every form of consent required by law. A user who disagrees may stop use and request termination/deletion."
          ]
        },
        {
          "id": "law",
          "title": "12. Governing law, disputes and effective date",
          "paragraphs": [
            "The laws of the Republic of Korea apply, subject to mandatory law and non-waivable consumer rights applicable to the user. Disputes should first be raised with the operator, then resolved through courts with jurisdiction under applicable law or available dispute-resolution procedures. No unfair exclusive venue is imposed.",
            "Korean and English versions aim to describe the same terms. To the extent permitted by law, the Korean text governs an interpretation difference. Invalidity of a provision does not invalidate the remaining valid terms. These terms first take effect on October 17, 2026.",
            "Operator: 오종현. Service and terms inquiries: taoss3932@gmail.com."
          ]
        }
      ]
    }
  }
};
