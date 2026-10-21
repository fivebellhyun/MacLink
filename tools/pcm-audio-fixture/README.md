# PCM 오디오 검증 페이지

현재 웹 PCM 플레이어와 AudioWorklet을 하나의 HTML에 포함하여 검증합니다. 가상의 48 kHz 스테레오 신호를 로컬 WebRTC 데이터 채널로 전달하며, 실제 Mac 소리·기기 등록·Google 계정·운영 API는 사용하지 않습니다.

먼저 `MackLink_Web/`의 의존성을 설치한 뒤 저장소 루트에서 실행합니다.

```bash
node tools/pcm-audio-fixture/build.mjs
node tools/pcm-audio-fixture/serve.mjs
```

브라우저에서 [로컬 검증 페이지](http://127.0.0.1:5314/fixture/audio)를 열고 **PCM 검증 시작**을 누릅니다. 준비가 끝나면 지연·전송 간격·일시 중단 버튼이 활성화됩니다. 작은 테스트 소리가 재생됩니다.

- 180 ms 전송 지연·커넥터 일시 중단 신호: PCM 재생 회복 확인
- 21 ms 전송·20 ms 전송: 송출 간격 변경
- 1.8초 전송 중단·잘못된 패킷: 해당 원인 표시와 스트림 종료 확인
- 중지 및 정리: 재생·연결·타이머 정리

종료한 테스트는 시작 버튼으로 다시 실행할 수 있습니다. 서버는 `127.0.0.1`에서만 수신하며 `Ctrl+C`로 종료합니다.

생성 파일은 Git에 포함되지 않는 `.build/pcm-audio-fixture/index.html`에 저장합니다. 이 파일은 외부 TypeScript 모듈을 직접 불러오지 않으며, 빌드 시점의 플레이어와 Worklet을 포함합니다. 제품 코드를 변경하면 다시 빌드합니다.

이 검증은 실제 원격 Mac과 Windows Chrome 사이의 네트워크·오디오 품질을 보증하지 않습니다.
