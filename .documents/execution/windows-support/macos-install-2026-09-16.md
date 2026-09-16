# macOS Commit Defender 재설치 — 2026-09-16

사용자의 재설치·배포 요청에 따라 macOS ARM64에 게시된 `pydemia.commit-defender@2.12.6`을 설치했다. 설치 전 버전은 2.11.3, VS Code는 1.137.0이다. Marketplace에서 기존 게시본을 설치했으며 새 버전을 빌드하거나 게시하지 않았다.

## Source와 artifact

- 작업 branch: `codex/windows-native-support`, 설치 시 source HEAD: `4d1b237ec50456a0e6c12904dbc878088e0d405a`.
- CD 제품 source: `3be0dc0ff3e243bb8e8fa7aa4fcac254d9ad7977`, packaging source: `3a39933b64750e89b8e5dc793bf4d0ab24cff124`.
- 공통 package source: GCR `2958d916abbca7f598818e6821db64349c20d3d1`; client-contract alpha.48 / client-core alpha.49 / client-executors alpha.50 / private CLI·service alpha.39.
- 게시된 darwin-arm64 VSIX SHA-256: `ca17b717a247ce8e919a583ec1b91a5e8114489328e94e45a740d611330f4e4d`. 이 값은 기존 게시 증거를 재사용한다. 이번 설치는 gallery CLI로 수행했으며 설치된 runtime 파일 11개의 SHA-256을 기존 artifact manifest와 직접 대조해 모두 일치함을 확인했다.

## 확인 결과와 적용 범위

VS Code CLI 설치가 성공했고 설치 목록에 2.12.6이 표시된다. 설치된 extension 경로를 사용하는 별도의 실제 Extension Host에서 activate를 실행해 버전 2.12.6, 활성화 성공, 기여 명령 26개 등록을 확인했다. 시험 workspace는 빈 Git 저장소이며 자동 실행을 비활성화한 전용 profile을 사용했다. 리뷰 실행과 실제 모델 호출은 0회다. 기존 W04 및 multiplatform 회귀 증거를 재사용하며 이번 검사를 새로운 전체 리뷰 회귀로 해석하지 않는다.

사용자의 VS Code settings.json과 기본 Codex config.toml·auth.json은 검사 전후 해시가 같다. 전역 CLI·provider·모델·자동 실행 설정은 변경하지 않았다. 시험 profile과 해당 Keychain 참조, 임시 workspace·VS Code user-data를 정리했다.

이미 열려 있던 사용자 Extension Host는 강제 reload하지 않았으며 실행 중인 버전은 이번 검사에서 확인하지 않았다. 열린 창에 새 설치본을 적용하려면 사용자가 작업을 저장한 뒤 `Developer: Reload Window`를 실행하거나 VS Code를 정상 재시작한다.

근거: [설치·Host 검사](evidence/macos-install-2026-09-16.json), [게시 artifact](evidence/multiplatform-artifact-linkage.json), [gallery 확인](evidence/multiplatform-gallery-validation.json). GCR 재배포는 GCR 저장소의 `docs/operations/redeploy-2026-09-16.md`에 별도로 기록한다.
