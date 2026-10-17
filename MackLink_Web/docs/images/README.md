# Original MacLink diagrams

Three diagrams are provided in English (`-en`) and Korean (`-ko`):

| Name | Content | PNG size |
| --- | --- | --- |
| `architecture` | Website coordination, direct WebRTC, optional encrypted TURN | 1760 x 1190 |
| `connection-paths` | Automatic ICE, one optional TURN/TLS retry, connection failure handling | 1760 x 1220 |
| `setup-flow` | Google sign-in, DMG installation, permissions, links and host email check | 1760 x 1300 |

The READMEs reference PNG files with relative paths, so they render on GitHub.
SVG files retain editable vector shapes. Text is outlined for portable rendering.
For editable wording, modify `generate_diagrams.py` and run it with Python 3.
The generator requires Inkscape on PATH, DejaVu Sans, and NanumGothic fonts.

All diagrams are original project illustrations, not screenshots or reused
images from the reference repository. They use the project license in
[../../LICENSE](../../LICENSE).

각 구조도는 영문·한글 PNG와 편집 가능한 SVG로 제공됩니다. 글꼴을 설치하지
않아도 보이도록 SVG의 글자는 윤곽선으로 변환했습니다. 문구를 바꾸려면
생성 스크립트를 수정하고 필요한 글꼴과 Inkscape를 설치해 다시 실행하세요.
