# 자동 리뷰 trigger 실행 조합 검증

Node.js 22 이상과 Git이 있는 macOS에서 `npm ci` 후 `npm run test:trigger-matrix`를 실행한다. 확장의 최소 Node runtime을 대상으로 하는 `npm test`와 달리 이 검사는 Node.js 22 이상이 필요한 background service CLI를 실제 자식 프로세스로 실행한다.

Save·Stage·Commit·Push의 16개 설정 조합마다 임시 Git 저장소와 로컬 bare remote, 고유 profile을 만든다. `AutomaticReviews`에 VS Code 저장/index 이벤트를 전달하고 `BackgroundHooks`로 독립 서비스 감시와 실제 hook을 구성한다. Save의 출처는 IPC로 전달하며 Stage는 서비스가 index를 재조회한다. 설치된 CLI artifact가 index와 pre-push stdin의 ref를 capture하고 실제 IPC로 요청을 접수한다. Git commit과 push는 service와 IPC를 주고받을 수 있도록 비동기로 실행한다.

검사하는 조건은 다음과 같다.

- 모든 toggle을 끄면 공통 요청과 executor 호출이 모두 0개다. 각 조합의 공통 요청 사유 집합은 켜진 trigger와 정확히 일치한다.
- Save·Stage를 포함한 모든 자동 리뷰는 독립 서비스에서 실행된다. Foreground 실행 port가 호출되면 실패한다. 저장 내용과 index가 그대로인 반복 이벤트는 추가 호출을 만들지 않는다.
- Stage와 Commit의 같은 index 입력은 하나의 요청·결과를 공유한다. Save의 working-tree와 Push의 commit-tree는 별도 요청이다. 네 trigger를 모두 켜면 executor 호출은 3회다.
- Commit hook을 두 번 직접 실행한 뒤 실제 commit을 수행한다. Push는 같은 ref로 dry-run 두 번과 실제 push를 수행한다. Trigger별 세 접수 기록은 같은 결과를 재사용하고 각 기록의 실행 key와 run ID가 공통 요청 기록과 일치한다.
- Git push 후 bare remote의 main은 로컬 HEAD와 일치한다. Hook의 advisory 성공뿐 아니라 서비스 작업의 finished와 보고서의 completed도 확인한다.

VS Code 이벤트 발신부와 executor는 합성이다. 서비스의 실행 callback은 배포된 client-core의 context·policy·review·broker API를 조합한다. CLI의 실제 service-run 인자 해석은 GCR의 CLI 회귀 검사에서 다루며 이 검사가 그 경로 전체나 실제 모델 품질 검증을 대신하지 않는다. Editor 관측용 시계 port는 유지하지만 서비스의 polling·debounce·lease·IPC·Git은 실제 시간으로 동작한다. 이 검사는 서비스 debounce의 정확한 시간 경계를 검증하지 않는다.

기본 local data directory에 고유 profile을 만들지만 OS credential 대신 테스트 전용 메모리 key port를 사용한다. 설정상 executor 경로는 `/usr/bin/false`로 고정하며 실제 모델 계정을 읽거나 호출하지 않는다. 종료 시 소유 hook을 해제하고 서비스가 더 이상 응답하지 않는지 확인한 뒤 고유 profile·hook 디렉터리·Git fixture·메모리 key를 정리한다. 공용 불변 CLI/adapter 설치 cache는 유지한다.

이 검사는 단일 저장소의 기본 변경과 반복 입력 조합을 다룬다. 실제 모델의 trigger 중복 경로, 여러 ref·부분 commit·base 변경, headless 감시, Linux·다른 UID 검증은 각각의 증거가 필요하다.

## 실제 Stage·Commit 중복 요청

`npm run test:trigger-overlap`은 macOS의 별도 VS Code profile에서 실제 계정 리뷰를 실행한다. Node.js 22 이상을 사용하고 아래 환경 변수를 명시한다.

- `CD_OVERLAP_ALLOW_MODEL=1`
- `CD_OVERLAP_EXTENSION_PATH`: 검증할 VSIX를 푼 `extension` 디렉터리의 절대 경로
- `CD_OVERLAP_EVIDENCE`: 새 JSON 증거 파일의 절대 경로. 기존 파일은 덮어쓰지 않는다.
- `VSCODE_EXECUTABLE_PATH`: VS Code 실행 파일의 절대 경로
- `CD_OVERLAP_CODEX`: 선택한 Codex 실행 파일의 절대 경로. 기본값은 `/opt/homebrew/bin/codex`다.

Stage의 공통 요청이 running이 되고 실제 계정 `exec`가 시작된 다음, 설치한 pre-commit hook을 호출한다. 같은 요청에 `stage`와 `commit` 사유가 함께 기록되고 모델이 계속 1회인 상태를 확인한다. 보고서·Stage 대기 해제가 완료되면 실제 Git commit을 수행하고 두 hook 접수 기록이 같은 실행 key/generation/run ID를 가리키는지 확인한다. HEAD는 중복 요청 합류를 확인하는 동안 고정하며 이후 실제 commit으로 변경한다.

호출 계수용 launcher는 인자·stdin·환경을 그대로 선택한 Codex에 전달한다. Executor 준비 과정의 `gcr_fixture` 로컬 provider 검사는 `probe-exec`, 계정 리뷰는 `review-exec`로 구분한다. 인자나 계정 자료를 기록하지 않는다. `npm run test:counted-codex`로 실제 모델 없이 분류와 인자 보존을 확인할 수 있다.

2.7.0의 실제 검사에서 관련 파일 수집 순서가 source hash에 반영되어 Stage와 Commit이 서로 다른 요청이 되는 결함을 발견했다. 2.7.1은 수집 우선순위를 유지하고 capture 완료 후 파일 순서를 정렬해 hash·직렬화를 고정한다. 위 16개 조합 fixture에도 변경 파일보다 먼저 정렬되는 호출부를 포함해 이 결함을 검사한다. 구버전의 저장 snapshot은 기존 hash와 순서로 복원하며, 기존 기록을 새 hash로 다시 쓰지 않는다.


## 실제 editor Save와 창 종료 후 감시

`npm run test:editor-save`는 별도 VS Code profile과 검증할 VSIX에서 현재 계정 모델을 세 번 호출한다. `CD_EDITOR_ALLOW_MODEL=1`, `CD_EDITOR_EXTENSION_PATH`, `CD_EDITOR_EVIDENCE`, `VSCODE_EXECUTABLE_PATH`를 지정하며 `CD_EDITOR_CODEX`로 실행 파일을 선택할 수 있다. 경로는 절대 경로를 사용하고 증거 파일은 새 파일이어야 한다.

Auto Save를 제외한 상태에서 자동 저장이 접수·모델 실행을 만들지 않는지 확인한다. 이후 수동 Save의 완료 결과가 Problems에 표시되고 다음 수정으로 지워지는지 확인한다. 두 번째 Save 리뷰가 running일 때 창을 닫아 정상 detach와 서비스 실행 지속을 확인하며, 창이 닫힌 뒤 새로운 외부 변경으로 세 번째 리뷰를 완료한다. 마지막에는 소유 프로세스와 profile key·fixture 정리를 확인한다. 활성화 전의 쓰기나 비정상 종료 전체를 이 정상 종료 검사로 검증하지 않는다.
