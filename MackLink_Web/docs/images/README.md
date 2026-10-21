# Original MacLink diagrams

The architecture and setup diagrams reflect Connector 1.4.0.
Three diagrams are provided in English (`-en`) and Korean (`-ko`):

| Name | Content | PNG size |
| --- | --- | --- |
| `architecture` | Website coordination, direct WebRTC, optional encrypted TURN | 1760 x 1190 |
| `connection-paths` | Automatic ICE, one optional TURN/TLS retry, connection failure handling | 1760 x 1220 |
| `setup-flow` | Google sign-in, DMG installation, permissions and same-account My devices access | 1760 x 1300 |

The READMEs reference PNG files with relative paths, so they render on GitHub.
SVG files retain editable vector shapes. Text is outlined for portable rendering.
For editable wording, modify `generate_diagrams.py` and run it with Python 3.
The generator requires Inkscape on PATH, DejaVu Sans, and NanumGothic fonts.

All diagrams are original project illustrations, not screenshots or reused
images from the reference repository. They use the project license in
[../../LICENSE.md](../../LICENSE.md).

각 구조도는 영문·한글 PNG와 편집 가능한 SVG로 제공됩니다. 글꼴을 설치하지
않아도 보이도록 SVG의 글자는 윤곽선으로 변환했습니다. 문구를 바꾸려면
생성 스크립트를 수정하고 필요한 글꼴과 Inkscape를 설치해 다시 실행하세요.

## Connector registration preview

[connector-registration-ko.png](connector-registration-ko.png) shows the actual
Connector 1.4.0 Home and Settings view code rendered offscreen in Korean.
The example confirmation code is synthetic. No device keys, real permission
states, workers or live account data are read for this documentation preview.

## Earlier Connector screenshot galleries

| Asset | Content | PNG size |
| --- | --- | --- |
| [connector-overview-en.png](connector-overview-en.png) | Home and Settings UI previews | 1536 x 1024 |
| [connector-settings-en.png](connector-settings-en.png) | Connection controls, permissions, and language settings | 1536 x 1024 |

These galleries were composed with the built-in image generation tool from
English preview captures of the MacLink 1.3.2 application. They illustrate the
interface; preview mode does not read connection keys or actual permissions.
The original captures were retained unchanged. The edited galleries are not
evidence of a live connection or granted permissions.

Source captures: `en-light-640-home.png`, `en-light-640-settings.png`, and
`en-light-640-settings-bottom.png` under the local
`.build/connector-spacing-20261017-final-review/previews/` directory.
The final PNG outputs were copied into this directory without further image
processing. The corresponding `*.prompt.txt` files record the full prompts.

Editing prompts: [Connector overview](connector-overview-en.prompt.txt) and
[Connector settings](connector-settings-en.prompt.txt).
