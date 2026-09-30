# 브랜치 리뷰와 PR 설명 초안

Commit Defender 사이드바의 Review Actions와 기존 Summary 화면을 기준으로
명령을 추가했습니다. 브랜치 선택은 VS Code Quick Pick을 사용하고, 리뷰 결과는
기존 Summary, Findings, History로 보냅니다. 새 화면이나 별도 카드 레이아웃은
추가하지 않았습니다. PR 설명은 편집 가능한 Markdown 문서로 엽니다.

**Review Branch Changes**는 현재 HEAD와 선택한 대상 브랜치의 merge base를
고정한 뒤, 그 구간에 커밋된 변경사항을 검토합니다. **Review Merge Impact**는
대상 브랜치에 현재 HEAD를 병합한 가상 트리를 만들고, 대상 브랜치에서 그
트리로 바뀌는 내용을 검토합니다. Git이 충돌을 보고하면 모델을 호출하지
않습니다. 대상 ref, index, 작업 트리는 수정하지 않습니다. 두 명령 모두
기존 공유 리뷰 코어를 사용하므로 선택한 중앙 정책 또는 로컬 기준과 리뷰
이력을 그대로 적용합니다.

**Generate PR Description**은 첫 번째 비교와 같은 커밋 스냅샷의 diff를
선택한 모델에 전달합니다. 결과는 제목과 본문 초안이며 PR을 생성하거나
게시하지 않습니다. 커밋되지 않은 수정은 세 명령 모두 입력에 포함되지
않습니다. Source Policy의 제외 규칙과 입력 크기 제한은 계속 적용됩니다.

검증에는 현재 사이드바 명령 목록, Summary의 상태·파일별 결과,
Commit Message 생성 흐름을 기존 UI 참고 자료로 사용했습니다. 회귀
테스트는 커밋 스냅샷 고정, 작업 트리 불변, 충돌 중단, 모델 locale,
공유 리뷰 실행기 전달을 확인합니다.
