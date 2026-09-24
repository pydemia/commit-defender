# 내장 연결 가이드와 설정 UI — 2026-09-24

Commit Defender 2.12.8은 `GCR Connection Guide`를 VS Code 내장 Walkthrough로
연다. 한국어와 영어 안내문·흐름도, 계정 선택·GCR 연결·설정 버튼을 제공한다.
`Open Settings` 명령과 사이드바의 톱니바퀴는 CD 항목으로 필터링한 기본 Settings
UI를 연다. `workbench.settings.editor`가 `json`이어도 이 명령은 UI를 연다.
기존 계정·모델·reasoning·자동 실행 설정은 사용자가 직접 편집할 때만 바뀐다.

가이드는 VS Code 표시 언어가 `ko` 또는 `ko-*`이면 한국어, 나머지는 영어를
선택한다. 첫 단계의 언어 버튼으로 전환할 수 있다. 단계 체크는 읽은 페이지를
표시하며 인증·연결·리뷰가 성공했다는 뜻이 아니다. reader key와 모델 API key는
기존 전용 자격 증명 입력창으로 관리한다.

## Reference와 구현

`reference-led-frontend`와 agent-skills의 `product-ui-ux-design`,
`web-publishing`, `frontend-development` 지침을 적용했다. VS Code의 확장 상세
README, 기본 Walkthrough와 Settings 화면을 비교했다. 단계별 안내에서 실제
설정 작업으로 이동할 수 있는 Walkthrough를 재사용했다. 자체 웹뷰나 UI
프레임워크는 추가하지 않았다.

- [Walkthrough contribution](https://code.visualstudio.com/api/references/contribution-points#contributes.walkthroughs): 내장 단계·본문·버튼과 정적 SVG를 사용한다.
- [확장 상세 뷰어](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/extensions/browser/extensionEditor.ts): README 렌더링 경로의 `disableServiceWorker` 처리를 확인했다.
- [Walkthrough renderer](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts): 정적 SVG 경로는 Service Worker 등록을 요구하지 않는다. 가이드에서 Markdown preview 대신 이 경로를 사용한다.
- [Settings 명령, 최소 지원 버전](https://github.com/microsoft/vscode/blob/1.90.2/src/vs/workbench/contrib/preferences/browser/preferences.contribution.ts#L207-L219): `openSettings2`에 `{ query: '@ext:pydemia.commit-defender' }`를 전달한다. 실제 화면 검사에서 문자열 인자가 필터에 반영되지 않는 문제를 발견해 수정했다.

SVG는 내장 renderer의 CSP에 맞춰 presentation attribute를 사용한다. 초기
후보의 SVG style 태그가 반영되지 않는 문제를 수정했다. 가이드의 본문과
도식은 오프라인으로 읽을 수 있다. 사용자가 보고한 Service Worker 오류의
환경 원인을 확정한 것은 아니며, 해당 등록이 필요한 가이드 경로를 교체했다.

CD가 발생시키는 오류 알림에는 `Commit Defender:`와 연결·리뷰 준비·복구·로컬
자료·모델 자격 증명·대화 등 발생 작업을 표시한다. 기존 오류 정제와 자격
증명 비노출 처리는 유지한다. VS Code 자체의 웹뷰 내부 오류 문구까지 확장이
바꿀 수 있는 것은 아니다.

## 검증과 설치

- TypeScript 및 테스트 typecheck, extension bundle 빌드 통과.
- 기존 central-view 6건, local-activity 5건, background-recovery 9건 통과.
  오류 출처 표시와 기존 비밀값 비노출 검사를 포함한다. TLS fixture는 Homebrew
  OpenSSL 3을 사용했으며 제품 인증서 검증은 변경하지 않았다.
- 최종 설치본으로 VS Code 1.90.2·1.137.0·1.138.0의 격리된 실제 macOS
  Extension Host에서 기본 언어·한국어·영어 가이드 명령,
  텍스트 편집기를 열지 않는 동작, Settings UI와 CD 설정 보존을 검사한다.
  이 API 검사는 렌더링 검증과 구분하며 상세 결과는 JSON 근거에 기록한다.
- 실제 UI에서 영어·한국어 본문과 흐름도를 확인했다. 언어 전환과 가이드의
  설정 버튼을 조작했다. SVG 웹뷰 URL의 `disableServiceWorker=true`를 확인했다.
  초기 명령 인자 오류는 실제 Settings 화면 검사로 발견했고 수정 후 재검증했다.
  최종 1.137.0 화면에는 User 탭과 CD 설정 34개, provider 선택·문자열 입력·
  체크박스·숫자 입력이 표시됐다. 설정 값은 편집하지 않았다.
- 사용자 settings.json·keybindings.json은 설치 전후 해시가 같다.
  모델 호출과 GCR 연결 생성은 0회다. 사용자 Extension Host를 재로드하지 않았다.

최종 제품 source는 `c7ee3746cc0ea39b6497d984a98dd3d8d01f3f7c`다. vsce 4.0.0으로
`darwin-arm64` VSIX를 만들고 로컬 설치했다. 설치본 실행 파일·SVG·문서 31개가
VSIX와 일치한다. runtime 파일 11개 중 `out/extension.js`만 2.12.7과 다르며
리뷰·대화 worker 등 나머지 10개는 동일하다.

- VSIX: `vscode-extension/test-results/native-connection-guide/commit-defender-2.12.8-darwin-arm64.vsix`
- SHA-256: `4164abdc5ccf664071fa1cff1c09f4f75681a274b5808b95403f2c5790ca58ef`
- 설치 위치: `~/.vscode/extensions/pydemia.commit-defender-2.12.8`
- 공통 package 유지: contract alpha.48 / core alpha.49 / executors alpha.50,
  private CLI·service alpha.39, native helper 1.0.3
- GCR 변경 없음: `5620858a51315e52a5779577d7ed914f144dbe8b`. 재배포 없음.

이미 열린 사용자 창에는 이전 Extension Host 코드가 남아 있을 수 있다.
작업을 마친 뒤 사용자가 `Developer: Reload Window`를 실행하거나 VS Code를
재시작하면 설치본이 적용된다. 명령 팔레트에서 `Commit Defender: GCR Connection
Guide` 또는 `Commit Defender: Open Settings`를 실행한다. Marketplace 게시와
Windows·Linux 실제 UI 검증은 이번 작업에 포함하지 않는다.

시험용 workspace·user-data·extensions 디렉터리와 진단용 artifact 복사본은
정리했다. 화면 자동화 중 일부 관측이 이전 상태를 반환했으므로 실제로 확인한
본문·전환·설정 화면만 UI 근거로 기록했다. screenshot의 확장 비활성화 알림은
다른 확장을 차단한 시험 profile의 상태이며 CD는 개발 확장으로 활성화했다.

근거: [artifact·Host·UI 결과](2026-09-24-native-viewer-evidence.json),
[한국어 가이드](native-viewer-screenshots/guide-ko.png),
[설정 UI](native-viewer-screenshots/settings.png).
