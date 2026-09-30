# 리뷰 실패 원인 표시 검증

## 관찰

2.14.9의 실제 단일 파일 리뷰는 중앙 지식을 `central-online`으로 불러왔고
Codex 모델 실행은 약 46초 진행됐다. 저장된 보고서의 실패 사유는
`invalid-output`의 `unknown-read-id`였다. 모델 응답에 이번 리뷰의
source read 기록에 없는 ID가 들어가 결과 검증에서 거부됐다. 원본 모델
응답은 보고서에 저장되지 않으므로 잘못된 ID 값이나 모델이 그 값을 만든
경위까지는 확인할 수 없다.

중앙 정책 접근 실패 시의 standalone fallback 조건은 이 실행에 해당하지
않았다. 실행 정보는 `effectiveMode: centralized`,
`knowledgeSource: central-online`, `fallbackReason: null`이었다.

## 화면과 동작

기존 Commit Defender Summary의 실패 영역을 유지하면서 저장된 문제
사유를 그 영역에 직접 표시한다. Output에도 세부 사유를 상태 코드 다음에
별도 줄로 기록한다. 모델 응답 검증 실패 알림에는 계정 로그인 액션을
제시하지 않는다. 이 판단은 기존 Summary와 실패 알림의 실제 구성을
reference로 삼았다.

## 검증

- `client-contract` 테스트에서 `unknown-read-id`의 한국어 안내가
  Summary의 기술 정보보다 먼저 표시되는지 확인한다.
- 응답 형식 오류의 세부 메시지는 HTML로 실행되지 않도록 기존
  Markdown 처리 규칙을 유지한다.
- `typecheck`, `typecheck:test`, `client-contract` 24개,
  `review-security` 11개, 실제 VS Code Extension Host 검증과 빌드를
  실행했다. 모델 호출로 동일 오류를 재현하지는 않았다.
