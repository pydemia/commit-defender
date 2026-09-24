# GCR 연결과 첫 리뷰

Commit Defender(CD)는 Git Code Reviewer(GCR)에 저장된 리뷰 이력·Skill·프롬프트·발행된 지침을 내려받아 사용합니다. 리뷰는 CD에서 선택한 계정과 모델로 실행하며, GCR 연결은 provider·모델·reasoning 설정을 바꾸지 않습니다.

이 문서는 확장에 포함되어 있어 인터넷이나 GCR 연결 없이도 읽을 수 있습니다. 명령 팔레트의 **Commit Defender: GCR Connection Guide**, CD 사이드바 상단의 도움말 아이콘, 또는 **Central Review Connection → GCR connection guide (연결 가이드)**에서 다시 여실 수 있습니다.

## 1. GCR에서 reader key와 연결 파일 준비

사용 중인 GCR 웹사이트의 **프로필**(`/profile`)에 로그인합니다.

1. **클라이언트**를 **Commit Defender**로 선택합니다.
2. 로컬에서 리뷰할 **저장소**를 선택하고 키 이름과 유효기간을 정합니다.
3. **API key 발급**으로 reader key를 발급합니다. CD에는 `commit-defender` 클라이언트용 `knowledge:read` 키가 필요합니다.
4. **선택한 저장소의 연결 설정 다운로드**로 JSON 파일을 받습니다.

연결 JSON에는 서버 주소, 저장소 식별자, 서명 검증용 공개키와 필요한 CA 인증서가 포함됩니다. reader key는 별도로 입력합니다. GCR 로그인 비밀번호·GitHub 토큰·모델 API key를 reader key 입력란에 넣지 마십시오. `gcr-cli`용 키도 CD에서 사용할 수 없습니다.

GCR 웹 화면이 HTTP를 허용하더라도 CD의 원격 GCR 연결은 **HTTPS**를 사용합니다. 관리자가 제공한 연결 JSON을 사용하고, 인증서 오류가 나면 서버 주소·인증서·CA 구성을 확인하십시오. 내부 CA도 연결 JSON으로 전달할 수 있습니다.

## 2. VS Code에서 저장소 열기

VS Code 1.90 이상에서 해당 Git 저장소 또는 worktree를 열고 워크스페이스를 신뢰합니다. GCR에서 선택한 저장소와 로컬 Git remote가 일치해야 합니다. 다른 fork는 별도 저장소로 취급합니다.

이하 명령은 명령 팔레트에서 실행합니다.

- macOS: `Cmd+Shift+P`
- Windows·Linux: `Ctrl+Shift+P`

## 3. CD의 계정·모델 선택

Codex 계정을 사용한다면 **Commit Defender: Select Account Provider and Model**에서 Codex와 모델을 선택합니다. 원하는 모델이 목록에 없으면 **Enter a model ID…**에 계정과 CLI가 지원하는 모델 ID를 입력합니다. 기존 Codex 로그인 계정을 사용하며, 로그인이 필요하면 **Commit Defender: Sign in with Codex**를 실행합니다.

VS Code **사용자 설정(User Settings)**에서 `commitDefender.reviewReasoningEffort`를 선택한 모델이 지원하는 값으로 지정합니다. 예를 들어 `high`를 사용할 수 있습니다. 현재 지원되는 Codex CLI는 `0.153.4` 또는 `0.154.0`이며, 실행 시 모델·reasoning·CLI 기능을 검증합니다. GCR에 등록된 분석용 계정은 CD에 자동 적용되지 않습니다.

OpenAI·Azure OpenAI·Anthropic·Gemini API를 사용한다면 사용자 설정에서 `commitDefender.aiProvider`, `commitDefender.model`과 필요한 endpoint를 지정하고 **Commit Defender: Manage Model API Credential**로 키를 등록합니다. Anthropic·Gemini API의 review reasoning 설정은 빈 문자열로 둡니다. [provider별 설정](standalone-review.md)에서 지원 범위를 확인하실 수 있습니다.

계정과 모델 선택은 사용자 설정에 저장합니다. 이 가이드를 여는 것만으로 기존 계정·모델·자동 실행 설정이 바뀌지는 않습니다.

## 4. GCR 연결

1. **Commit Defender: Central Review Connection**을 실행합니다.
2. **Connect with API key…**를 선택합니다.
3. 내려받은 연결 JSON을 선택합니다.
4. 표시되는 서버·tenant·저장소·서명 공개키 정보를 확인합니다.
5. reader key를 비밀번호 입력란에 입력합니다.

키는 OS 자격 증명 저장소에 보관됩니다. 설정 파일에 직접 적을 필요가 없습니다. 최초 자료 발행과 서명 검증은 최대 60초 정도 기다릴 수 있으며 취소할 수 있습니다. 연결은 현재 로컬 profile과 Git worktree에 적용됩니다.

## 5. 연결과 자료 확인

**Central Review Connection**에서 아래 항목을 사용할 수 있습니다. 조회·동기화 자체는 모델을 호출하지 않습니다.

| 메뉴 | 확인할 내용 |
| --- | --- |
| Connection status | 서버·저장소·사용자, 키 만료일, 마지막 동기화, snapshot과 유효기간 |
| Synchronize knowledge | 중앙 자료를 내려받고 서명을 검증한 뒤 활성화 |
| View downloaded review knowledge | 내려받은 Skill·프롬프트·검토 지침 |
| Browse PR review history | PR 코멘트 원문·답글·본문 버전·출처 연결 지침 |

일반 온라인 자료는 최대 5분의 갱신 주기를 가지며 백그라운드에서 동기화합니다. 리뷰 실행 중에는 사용한 자료 버전을 고정합니다. 원문은 과거 관측으로 다루고, 적용 조건과 반증·수정 문맥을 현재 코드와 함께 판단합니다.

## 6. 첫 리뷰 실행

작은 변경을 저장하고 stage한 뒤 **Commit Defender: Analyze Staged Files**를 실행합니다. 저장했지만 stage하지 않은 파일은 **Analyze Current File**을 사용합니다.

결과의 완료·부분 완료·실패 상태를 먼저 확인하고 **Show Summary Panel**에서 지적 내용과 사용한 출처·snapshot·지침 버전을 확인합니다.

| 결과에 표시된 모드 | 의미 |
| --- | --- |
| Centralized · online | 온라인에서 검증한 중앙 자료를 사용 |
| Centralized · cached | 유효한 서명 캐시를 사용 |
| Standalone · fallback: 사유 | 설정된 fallback 정책에 따라 중앙 자료 없이 로컬 리뷰 실행 |

GCR로 로컬 코드·diff·질문·리뷰 결과·대화·개인 메모리를 업로드하지 않습니다. 리뷰에 필요한 코드와 문맥은 **사용자가 선택한 모델 provider**로 전달됩니다. 로컬 provider 선택이 곧 기기 내부 추론만을 뜻하지는 않습니다.

## 연결이 되지 않을 때

| 증상 | 확인할 항목 |
| --- | --- |
| 명령이 보이지 않음 | 확장이 설치·활성화되었는지 확인합니다. 설치 직후 기존 창에는 이전 버전이 남아 있을 수 있습니다. 진행 중인 작업을 마친 뒤 필요할 때 직접 창을 다시 로드합니다. |
| 인증 실패 또는 401/403 | 키가 CD용인지, 만료·철회되었는지, 선택한 저장소 읽기 권한이 있는지 확인합니다. |
| 저장소 불일치 | 로컬 Git remote와 연결 JSON의 저장소를 확인합니다. remote를 바꿨다면 해당 저장소로 다시 연결합니다. |
| 인증서 오류 | HTTPS 서버 주소와 관리자가 제공한 CA·인증서 구성을 확인합니다. |
| 중앙 자료가 없거나 서버에 연결되지 않음 | Connection status와 Synchronize knowledge로 확인합니다. 발행된 자료 유무와 일시적인 서버 장애를 구분합니다. |
| 모델 실행 실패 | CD의 계정 로그인, 모델·reasoning, provider 사용량과 지원 CLI 버전을 확인합니다. reader key와 별개의 문제입니다. |

**Offline and fallback behavior…**에서 장애 시 동작을 선택할 수 있습니다. **Use standalone review**는 저장된 중앙 연결을 유지한 채 로컬 자료로 리뷰합니다. 철회·만료되었거나 서명이 유효하지 않은 중앙 자료는 재사용할 수 없습니다.

연결·캐시의 상세 동작은 [Central review](central-review.md), 설치와 플랫폼별 조건은 [Installation](installation.md)에서 확인하실 수 있습니다.
