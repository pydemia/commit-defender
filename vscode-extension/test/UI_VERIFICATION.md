# 실제 결과 상태 화면 검증

`npm run test:outcome-ui`는 설치된 VS Code의 Development Host를 별도 workspace·user-data·extensions 디렉터리로 실행한다. 사용자 provider 설정과 hook을 바꾸지 않는다. 임시 합성 CLI만 호출하며 실제 모델 계정은 사용하지 않는다. Mac 잠금이 해제되어 있어야 화면을 조작할 수 있다.

Console의 `OUTCOME_CONTROL` 경로에서 `stage.json`을 읽는다. 실행은 completed → failed → partial → cancelled 순서로 진행하며 매 단계에서 다음 확인을 기다린다.

- 실제 summary badge·상태 표시줄·history가 현재 상태를 표시하는지 확인한다. Failed에서는 이전 finding/진단이 사라지고 partial/cancelled에서는 완료한 첫 파일의 finding이 남아 있어야 한다. 미완료 결과에 PASS나 전체 grade가 표시되면 안 된다.
- 화면의 **Raw JSON**을 클릭한다. Extension Host가 VS Code에 실제로 열린 JSON document에서 현재 report, 파일별 상태, finding과 diagnostic 수를 검사한다. 첫 report가 계속 반환되는 stale closure도 검출한다.
- 화면 확인을 마친 뒤 control 디렉터리에 `ack-completed`, `ack-failed`, `ack-partial`, `ack-cancelled` 중 현재 단계의 빈 파일을 만든다. 컴퓨터 제어 도구나 사람이 화면을 확인한 뒤 작성해야 한다. 파일 생성만으로 시각적 검증을 대신하지 않는다.

각 대기는 최대 240초다. 종료 시 `test-results/outcome-host/`에 제어 상태와 결과를 복사하고 임시 workspace/profile을 정리한다. 성공은 `evidence.json`의 `status: passed`와 각 report, 실제 화면 확인을 함께 확인해야 한다. `attempt.json`의 실패, 대기 상태, 앱 실행만으로 성공을 기록하지 않는다. 잠금 등 환경 문제로 실패하면 해당 process가 종료된 것을 확인하고 원인을 해결한 뒤 재실행한다.

이 검사는 source의 Development Host 동작을 확인한다. P09의 고정 VSIX hash·별도 설치·publisher 인증·동일 VSIX 게시·Marketplace 재설치 검증은 별도로 수행한다.
