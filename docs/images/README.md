# Original MacLink diagrams

The architecture and setup diagrams reflect Connector 1.4.0; that connection
architecture is unchanged in 1.4.1. The native UI previews below use 1.4.1.
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

## Native Connector UI previews

| Asset | Content | PNG size |
| --- | --- | --- |
| [connector-registration-en.png](connector-registration-en.png) | English Google registration and example verification code | 1776 x 1648 |
| [connector-registration-ko.png](connector-registration-ko.png) | Korean Google registration and example verification code | 1776 x 1648 |
| [connector-overview-en.png](connector-overview-en.png) | English Home and Settings with example connected/allowed labels | 1776 x 1648 |
| [connector-settings-en.png](connector-settings-en.png) | English account controls, permissions, language and version check | 1776 x 1648 |

English README images use the English interface; the Korean README retains the
Korean registration image. These replace the earlier 1.3.2 galleries that showed
manual key import as the primary setup flow.

The images are rendered directly from the current `ConnectorPanel` AppKit view
code by [generate_connector_previews.py](generate_connector_previews.py). The
export uses native vector drawing rasterized at 2x, then composes the panels
with documentation captions. Scroll content is expanded or presented in
sections to keep the actual controls readable. It is not an AI-generated
reconstruction of the interface.

Every connection status, permission label, device name and confirmation code
is synthetic. No app window is opened, no worker starts, and no connection key,
live permission state, account data or configuration is read. Language is
overridden only in the export process; the user's preference is not changed.
The version-check example uses the current public installer manifest and shows
Connector 1.4.1 as up to date.
These illustrations do not establish a live connection or granted permissions.

To regenerate on macOS after preparing the Connector build environment:

```sh
.build/maclink/venv/bin/python docs/images/generate_connector_previews.py
```

The exporter requires AppKit/PyObjC and Pillow from that environment. It never
installs, launches or updates `/Applications/MacLink.app`.
