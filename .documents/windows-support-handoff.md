# Windows 네이티브 지원 작업 인계

작성일: 2026-09-16. 계획만 작성했으며 Windows 구현은 아직 시작하지 않았다.

전체 phase·commit·수용 기준과 첫 goal 명령은 GCR 저장소의 [Windows 지원 구현 계획](https://github.com/pydemia/git-code-reviewer/blob/codex/review-memory-pull-g01/.documents/windows-support-implementation-plan.md)을 따른다. 두 저장소를 함께 checkout해야 한다. 공통 코드를 CD vendor에서 직접 수정하지 않는다.

| 대상 | 가져올 branch | 최소 기준 SHA | Windows 작업 branch |
| --- | --- | --- | --- |
| GCR | `codex/review-memory-pull-g01` | `f40e0437a79ffb7fcecb6a089abfde2c2a7ba522` | `codex/windows-native-support` |
| CD | `codex/review-memory-pull-g03` | `708710178ae1c47cd89e822d7d982fe437a8e5fd` | `codex/windows-native-support` |

위 최소 SHA 이후의 계획·인계 문서 commit까지 fetch한다. Windows의 실제 작업 경로와 시작 SHA를 기록하고 현재 사용자 변경은 보존한다. Mac 경로나 auth.json을 복사하지 않는다.

진행 순서는 W01 보안 저장·프로세스·Codex 격리와 실제 수동 리뷰, W02 중앙 pulling·출처 판단, W03 기존 자동 서비스·hook 이식, W04 플랫폼 회귀·VSIX 전달이다. W01부터 별도 goal로 실행한다. 현재 Windows 지원 완료를 선언하거나 플랫폼 guard만 제거하지 않는다.

CD 확인 위치는 `vscode-extension/src/standaloneReview.ts`, `localKnowledge.ts`, `config.ts`, `backgroundHooks.ts`, `hook/managedHooks.ts`, `scripts/prepare-service.mjs`, `vendor/gcr`, package/lockfile과 기존 테스트다. 상세 공통 package 경로는 전체 계획에 있다.

현재 기준 artifact는 client alpha.42·private service alpha.37·VSIX 2.11.3이다. 문서·화면 보강 source는 기존 설치 VSIX보다 앞서 있다. 수정된 제품은 새 버전으로 패키징하고 두 저장소 source SHA·artifact hash·설치와 열린 Host 적용 상태를 연결한다. 기존 artifact를 덮어쓰지 않는다.

중앙→local 읽기 구조, 사용자 선택 provider, 민감 파일 제외, 취소·실패 의미와 signed cache 만료를 유지한다. Marketplace 게시·전역 CLI 교체·강제 reload·신규 runner·자동화 확대는 이번 작업에 포함하지 않는다.
