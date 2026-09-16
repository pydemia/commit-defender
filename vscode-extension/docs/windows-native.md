# Windows native 사용과 복구

현재 검증한 조합은 Windows 11 Pro build 26200 ARM64, 로컬 NTFS,
VS Code 1.137.0 ARM64, Host Node 24.18.1, 외부 Node 24.16.0,
Codex CLI 0.153.4의 기존 계정과 `gpt-5.6-luna / high`다.
다른 Windows/CPU/VS Code/Node/Codex 조합은 별도 검증이 필요하다.
AnyCPU helper가 포함됐다는 사실은 Windows x64 실행 검증이 아니다.

W04의 macOS ARM64 native 회귀와 W03 임시 폴더 수동 정리를 완료했다.
W04는 명시된 검증 범위에서 완료했다. 전체 근거는 저장소의
[W04 실행 기록](../../.documents/execution/windows-support/W04.md)을 따른다.

## 설치와 적용 확인

전달물은 `commit-defender-2.12.4-win32-arm64.vsix`다.
SHA256은 다음과 같다.

`88471efee2b80a1b79d28e4712d90566eeeac1fa3ea6fa340d515efba5a48f1b`

VS Code Extensions의 **Install from VSIX…**에서 해당 파일을 선택한다.
이 PC에는 이미 설치됐으므로 W04에서는 재설치하지 않았다. 설치된 확장 버전은
2.12.4지만 이미 열린 창이 적용한 버전은 미확인이다. 진행 중인 리뷰를 마친 뒤
원하는 시점에 창을 다시 열거나 Reload Window를 선택한다. 설치만으로 실행 중인
Host나 독립 service가 교체되지는 않는다.

실제 검증 Host는 설치 경로의 2.12.4를 로드했다. 사용자 Host를 강제로
재로드하지 않았으며 전역 CLI·계정·모델 설정도 변경하지 않았다.
문서만 갱신한 W04는 제품 package를 다시 만들지 않았다. 이 문서가 checkout의
최신 안내이며 기존 VSIX 내부 문서는 이전 bytes를 유지한다.

## 수동 리뷰와 저장 결과

trusted Git workspace에서 기존 계정과 원하는 profile을 확인한다. 이번 검증은
기존 Codex 계정을 그대로 사용했다. `Select Account Provider and Model`은
사용자가 선택을 바꿀 때 사용하며 설치를 위해 계정을 다시 만들 필요는 없다.
중앙 연결 없이 사용할 때 review mode는 standalone이다.

- 저장한 파일은 **Commit Defender: Analyze Current File**로 검토한다.
- 실제 index는 **Commit Defender: Analyze Staged Files**로 검토한다.
- **Refresh Local History**, **Show History Entry**에서 저장 결과를 다시 연다.

완료 여부는 최종 report 상태, problems, 근거·출처 검증을 함께 확인한다.
CLI exitCode 1은 결함 발견일 수 있으므로 실행 실패와 구분한다. partial,
timeout, failed, unknown-read-id를 성공으로 판단하지 않는다. 모델이 source나
테스트를 읽은 기록은 테스트 실행 기록이 아니다.

API credential은 기존 **Manage Model API Credential**의 보안 입력을 사용한다.
hook에는 credential 참조만 전달한다. 키를 설정 JSON, argv, 환경변수나 평문
임시 파일에 넣지 않는다. Windows Credential Manager와 사용자 범위 암호화
저장소에 접근할 수 없으면 평문으로 대체하지 않는다.

Codex 실행은 NTFS의 기존 auth.json만 private home에 연결한다. 원래 계정
파일과 같은 NTFS 볼륨이 필요하다. keyring-only 계정, UNC/FAT와 다른 볼륨의
hardlink 제약을 sandbox 해제나 auth 복사로 우회하지 않는다.

## 자동 리뷰 opt-in과 hook

**Commit Defender: Automatic Reviews**에서 현재 repository/worktree의
Save/Stage/Commit/Push를 개별 선택한다. 기본값은 모두 꺼짐이다.
repository 설정만으로 자동 실행을 켤 수 없다. 선택은 확장의 사용자 상태에
저장되며 User Settings가 기본값을 제공한다.

독립 service에는 native Node.js 22 이상이 필요하다. PATH 탐색이 실패하거나
오래된 Node라면 `commitDefender.serviceNodePath`에 원하는 `node.exe`를 지정한다.
Codex 실행 파일과 service Node는 서로 다른 프로그램이다. `.cmd` wrapper나
WSL을 Windows native 실행 파일로 지정하지 않는다. 기존 service와 모델 선택을
설치 과정에서 자동 변경하지 않는다.

Save는 명시적으로 저장한 working-tree, Stage/Commit은 index, Push는 전송할
commit-tree를 고정한다. 기본적으로 Auto Save와 외부 변경은 제외한다.
반복 입력은 3초 동안 모으고 Save 최소 간격은 600초, profile/worktree의 자동
리뷰 시작 한도는 시간당 6회다. 수동 리뷰가 새 자동 모델 시작보다 우선한다.
이미 승인된 리뷰는 별도로 진행될 수 있다.

Git for Windows hook은 native Node advisory에 전달한다. 기존 hook은 원래
위치에서 Git의 hook 실행 규칙으로 먼저 실행되며 bytes·stdin·종료 상태를
보존한다. managed hook은 repository의 local `core.hooksPath`만 관리한다.
원래 hook이 실패하면 Git 실패를 유지한다. 모델 결함이나 service 장애가
성공한 원래 hook을 새로 차단하지 않는다. `hookReviewWaitSeconds` 기본값 0은
durable enqueue 후 반환이며 모델 완료를 뜻하지 않는다.

기존 legacy Python pre-commit hook은 별개다. 이 검증이 legacy Python hook의
Windows native 전체 지원을 추가하지 않는다. 자동 service 등록은 현재 지원되는
Codex executor를 요구하며 수동 API adapter 지원과 구분한다.

## 일시 정지·해제

Automatic Reviews에서 **Pause automatic reviews in this worktree**를 선택하거나
필요한 trigger를 끈다. 전체 정지는 **Pause all automatic reviews**다.
전역 재개는 User Settings의 `commitDefender.automaticReviewsPaused`를 해제한다.
worktree 선택은 전역 pause를 덮어쓰지 못한다.

해제는 확장이 소유한 grant와 managed hook route를 제거한다. 마지막 route가
없어지면 기존 local hooksPath를 복원한다. 이후 다른 도구가 바꾼 hook이나
hooksPath는 덮어쓰지 않고 충돌을 보고한다. 파일을 일괄 삭제하거나 Git 전역
설정을 바꿔 해제하지 않는다. service가 멈췄다면 철회 상태를 저장하여 재시작이
이전 grant를 다시 활성화하지 못하게 한다.

일시 정지는 독립 service process 종료와 다르다. 다른 repository/profile의
리뷰가 있는 service를 임의로 종료하지 않는다.

## service 정지·버전 교체

실행 중 process의 경로·profile·데이터 디렉터리와 프로그램 hash를 먼저 확인한다.
VSIX의 `out/gcr-service/main.mjs`와 실제 process가 사용하는 private copy를
대조한다. 2.12.4의 private CLI/service는 0.1.0-alpha.38이고 bundle SHA256은
`47d59eb3b668d2d9067730ed963cedb244f96876e7708af61145fcf05b8ef364`다.
이 검증 종료 시 GCR service는 없었다.

본인이 관리하는 profile의 자동 trigger를 pause하고 진행 중인 리뷰가 끝난 뒤
그 profile의 service를 정상 정지한다. 다음은 실제 CLI 문법이며 경로와 profile은
관찰한 값으로 바꾼다. 비밀을 인자로 전달하지 않는다.

```powershell
& '<native node.exe>' '<service entrypoint>' service status --profile '<profile>' --data-dir '<private directory>'
& '<native node.exe>' '<service entrypoint>' service stop --profile '<profile>' --data-dir '<private directory>'
```

정지가 확인된 뒤 새 확장이 적용된 창에서 필요한 trigger만 다시 opt-in한다.
확장이 새 hash의 프로그램을 private storage에 배치하고 같은 profile의 service를
기동한다. CLI로 관리하는 경우 새 entrypoint의 `service start`를 같은
`--profile`·`--data-dir`로 실행한다. 기존 service가 있으면 start는 그 상태를
반환하므로 새 설치본으로 자동 교체됐다고 판단하지 않는다. master key·history·
기존 service 프로그램을 삭제해서 버전을 교체하지 않는다.

## 중단 결과와 중앙 연결

**Commit Defender: Recover Background Review**에서 interrupted 작업을 선택하면
저장된 완료 결과를 대조한다. 일치하는 저장 결과가 없으면 interrupted를 유지하며
모델을 새로 호출하지 않는다. service restart required라면 해당 profile의
정상 재시작 후 다시 확인한다. refresh/recovery가 이전 source의 diagnostics를
현재 편집기에 무조건 복원하지는 않는다.

중앙 reader 연결은 [중앙 리뷰 안내](central-review.md)의 기존 보안 입력으로
설정한다. source/diff/질문/결과/개인 memory를 중앙에 업로드하지 않는다.
TLS/CA/pin, 온라인 manifest 5분 제한과 signed offline lease를 유지한다.
중앙 자료 없음, 서버 장애, 403, 철회, 만료와 모델 실패를 구분한다.

W02 증거는 사용자 승인으로 PRISM #917/#915 대신 GitHub PR #3과 로컬 GCR를
사용했다. 시험 서버·DB·credential은 정리됐다. 전달물을 설치해도 그 검증 연결이
운영 연결로 생기지 않는다.

Linux container의 회귀는 Windows native나 macOS native 증거가 아니다.
Windows x64, 다른 버전 조합, WSL/Remote SSH/Dev Container는 이번에 검증하지
않았다. 사용자 단위 token budget, 보존 정책과 editor 초기 연결/crash의 기존
제약은 [자동 리뷰 안내](automatic-reviews.md)의 지원 범위를 유지한다.
