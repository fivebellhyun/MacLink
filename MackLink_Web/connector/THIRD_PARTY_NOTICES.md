# Third-party notices / 외부 구성 요소 고지

MacLink's original project code, documentation and assets are provided by
fivebellhyun under the [MacLink NonCommercial Attribution License](LICENSE).
That license applies only to material its licensor has the right to license.
It does not replace, remove, or narrow licenses granted by third parties.

MacLink의 원본 프로젝트 코드·문서·자산에는 [MacLink 비상업적 이용 및 출처 표시 라이선스](LICENSE.ko.md)가 적용됩니다. 이 조건은 해당 권리자가 이용을 허락할 수 있는 부분에만 적용되며, 외부 구성 요소의 라이선스를 대체·삭제·축소하지 않습니다.

## Notices shipped in this repository

| Material | Copyright / origin | License and retained notice |
| --- | --- | --- |
| `build/sites-vite-plugin.ts` | OpenAI; vendored `@openai/sites-vite-plugin` 0.2.0 | MIT; [original notice](build/sites-vite-plugin.LICENSE) |
| `vendor/shadcn-tailwind-4.13.0.css` | shadcn | MIT; [original notice](vendor/shadcn-tailwind-4.13.0.LICENSE.md) |

Both notice files are retained unchanged. Retain them when redistributing the
corresponding materials. The custom MacLink license does not revoke their
separately granted permissions.

## Installed dependencies

JavaScript packages declared in [package.json](package.json) and resolved in
[pnpm-lock.yaml](pnpm-lock.yaml), and Python packages declared in
[connector/requirements.txt](connector/requirements.txt), are separate works.
Their respective upstream licenses, notices, and distribution requirements
continue to apply. A project-level license is not a substitute for them.

Examples used by this project include React, Next.js, Vinext, Vite, Cloudflare
tooling, Drizzle, Radix/shadcn components, Lucide icons, aiortc, PyObjC, aiohttp,
Pillow, and MSS. This list is an orientation aid, not a complete license audit
of direct or transitive dependencies. Review the license files shipped with
the exact dependency versions when redistributing those dependencies.

프로젝트의 JavaScript·Python 의존성에는 각 배포본에 포함된 원래 라이선스와 고지가 적용됩니다. 위 예시는 모든 직접·간접 의존성에 대한 라이선스 감사 목록이 아닙니다. 의존성 자체를 재배포할 때에는 실제 사용하는 버전에 포함된 조건을 확인하십시오.

## README reference and diagrams

The documentation structure was inspired by the stepwise guide in
[rodrigomarinsp/ngrok-macos-instalation](https://github.com/rodrigomarinsp/ngrok-macos-instalation).
The MacLink prose and architecture diagrams were created specifically for
this project. No images or substantive prose from that guide are included.
The reference does not imply shared implementation, endorsement, or use of
ngrok by MacLink.

README의 단계별 구성은 위 저장소를 참고했습니다. MacLink 본문과 구조도는 이 프로젝트를 위해 새로 작성했으며, 참고 문서의 이미지나 본문을 복제하지 않았습니다. MacLink는 ngrok에 의존하지 않습니다.


## Native app distribution

MacLink's app build collects available Python dependency license and notice texts
under `MacLink.app/Contents/Resources/legal/python`. Those upstream terms continue
to apply to bundled dependencies. Including these files is not a complete license
compliance audit; review the exact bundled versions and their redistribution terms
before publishing a build.

The macOS menu bar and DMG installation workflow was inspired by
[guhcostan/mac-cleaner-cli](https://github.com/guhcostan/mac-cleaner-cli).
No code from that repository was copied into MacLink. This reference does not imply
shared implementation or endorsement.

앱 빌드는 Python 의존성에서 제공하는 라이선스·고지 파일을 위 `legal/python` 경로에
모읍니다. 이를 모든 의존성에 대한 라이선스 준수 감사로 간주하지 마세요. 배포 전
실제로 포함된 버전의 재배포 조건을 확인해야 합니다. mac-cleaner-cli는 메뉴 막대와
DMG 설치 흐름의 참고 자료이며 해당 저장소의 코드를 복사하지 않았습니다.
