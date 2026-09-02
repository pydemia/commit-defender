# GitHub Enterprise PR 분석 플랫폼 기획 및 설계

상태: 제안(Proposal)
대상: 사내 GitHub Enterprise Server(GHES)의 pull request
배포 형태: 사내 분석 서버 + worker + web report/chat + 선택적 browser extension
외부 SaaS: LLM provider만 허용
중앙 분석 서버: 사내 accessible network에 배포

## 1. 결론

Commit Defender를 webhook 기반의 사내 PR 분석 플랫폼으로 구성한다. GHES에서
PR이 생성되거나 새 commit이 push되면 분석 서버가 이벤트를 받아 exact
`base SHA`와 `head SHA`를 고정하고, 격리된 작업 directory에서 변경 및 저장소
영향을 분석한다. 완료 후 하나의 bot comment를 PR에 생성하거나 갱신한다.
comment에는 요약, 실행 상태, 분석 revision과 인증이 필요한 report URL을 넣는다.

사용자는 report URL을 눌러 항상 동작하는 web report 화면을 연다. browser
extension이 설치되어 있으면 같은 URL을 감지해 side panel이나 확장 UI로
enhance할 수 있지만, 링크의 기본 target은 `chrome-extension://`이 아니라 사내
HTTPS web app이다. 따라서 extension ID, browser 정책 또는 미설치 상태와 무관하게
보고서에 접근할 수 있다.

보고서 화면에는 analysis snapshot에 고정된 chat service를 제공한다. 사용자는
PR 변경, finding, base repository 영향에 대해 질문하고 서버는 필요한 code만
추가 검색해 LLM으로 on-demand 분석한다. 자동 분석과 remote chat은 브라우저가
닫혀 있어도 실행되어야 하므로 서버 측 LLM credential이 필요하다. 로컬
`codex`/`claude`/`agy` 개인 로그인만으로 이 비동기 서버 작업을 실행할 수는 없다.
초기 구현은 조직 공용 provider API credential을 vault에서 관리하고, 필요하면
후속 단계에서 tenant별 또는 사용자 BYOK를 추가한다.

각 analysis run은 PR별 tenant 전용 directory에 **독립 repository clone**을
만든다. `.git`, object database, refs, config, index와 working tree를 다른 PR/job과
공유하지 않는다. 성공·실패·취소 후 clone directory 전체를 삭제한다. 이 방식은
network와 disk 중복보다 격리, tenancy, 장애 범위와 분석 재현성을 우선한다.

여기서 독립 full clone은 다른 job과 Git state를 공유하지 않는다는 뜻이지, 긴
history와 모든 blob을 최초부터 전부 내려받는다는 뜻은 아니다. 초기 fetch는
server 지원 범위에서 `--filter=blob:none`, `--no-tags`와 bounded depth를 사용한다.
merge-base를 찾지 못할 때만 제한까지 단계적으로 history를 deepen한다. 모델에는
Git history 전체가 아니라 exact PR diff, 변경 파일과 영향 분석으로 선별한 base
code만 전달한다.

이 문서에서 **PR별 full clone**은 exact base/head revision의 전체 source tree를
분석할 수 있고 `.git` 저장소가 run별로 독립된다는 제품 용어로 사용한다. 모든
branch/tag의 전체 history와 모든 unreachable object까지 받는 unbounded clone을
뜻하지 않는다.

## 2. 목표와 비목표

### 2.1 목표

- `pull_request` webhook으로 최초 분석과 새 commit 재분석을 자동 trigger한다.
- exact base/head SHA를 기준으로 재현 가능한 분석 결과를 만든다.
- PR diff뿐 아니라 base repository의 caller/importer/schema/config 영향을 찾는다.
- merge 결과를 별도로 시뮬레이션해 conflict와 통합 위험을 탐지한다.
- PR에는 짧은 상태/요약과 사내 report link만 게시한다.
- report web app과 선택적 browser extension에서 같은 결과를 표시한다.
- report snapshot을 기반으로 사용자별 remote chat을 제공한다.
- username/password 인증과 tenant/user 경계로 데이터 접근을 격리한다.
- 모든 clone, 분석, report, chat과 GitHub write-back을 감사 가능하게 기록한다.

### 2.2 비목표(MVP)

- LLM 결과만으로 merge를 자동 승인하거나 차단하지 않는다.
- PR branch의 code, build script, test, package lifecycle script를 host에서 직접
  실행하지 않는다.
- 임의 repository URL이나 shell command를 webhook 또는 browser에서 받지 않는다.
- GitHub inline review comment를 finding마다 생성하지 않는다.
- browser extension 설치를 report 열람의 필수 조건으로 만들지 않는다.
- 사용자별 persistent clone이나 shared working copy를 만들지 않는다.
- GitLab/Bitbucket은 초기 범위에 포함하지 않는다.

## 3. 핵심 사용자 흐름

```text
PR opened/synchronize/reopened/ready_for_review
  → GHES webhook
  → signature 검증 및 event 저장
  → queue에 analysis job 등록
  → exact base/head SHA fetch
  → isolated workspace 생성
  → static + repository impact + LLM review
  → immutable report revision 저장
  → 현재 PR head인지 재검증
  → PR bot comment upsert
  → 사용자가 report HTTPS link 클릭
  → 로그인 및 tenant/repository 권한 확인
  → web report 또는 extension-enhanced view
  → user chat 질문
  → snapshot-bound retrieval/tool 호출
  → on-demand LLM 응답 stream
```

### 3.1 PR 이벤트 정책

분석을 시작하는 `pull_request` action:

- `opened`
- `reopened`
- `synchronize`
- `ready_for_review`

정책으로 선택할 action:

- `edited`: base branch가 바뀌었을 때만 재분석
- `labeled`/`unlabeled`: 분석 정책 label이 바뀌었을 때만 재분석
- `converted_to_draft`: 실행 중 job 취소 여부를 tenant 설정으로 결정
- `closed`: 실행 중 job을 취소하고 workspace를 정리하되 report는 retention 정책 유지

base branch에 새 commit이 들어온 경우 PR의 head가 같아도 merge 결과가 달라질 수
있다. `push` webhook으로 해당 branch를 base로 하는 open PR을 찾아 debounce 후
재분석하거나, 일정 주기의 reconciliation job으로 누락 이벤트를 보완한다.

### 3.2 상태 머신

```text
received → queued → preparing → analyzing → publishing → completed
                 └→ cancelled
                 └→ failed_retryable → queued
                 └→ failed_terminal
completed → superseded  # 더 최신 base/head 분석이 존재
```

idempotency key:

```text
tenant_id/repository_id/pr_number/base_sha/head_sha/
policy_version/engine_version
```

같은 key가 이미 완료되었으면 report를 재사용한다. `synchronize`가 연속으로 오면
짧게 debounce하고 이전 head의 queued/running job은 취소한다. publish 직전에
GHES에서 현재 base/head SHA를 다시 읽고 다르면 결과를 `superseded`로 보존하되
PR comment를 최신 결과처럼 갱신하지 않는다.

## 4. 권장 아키텍처

```text
┌────────────────────── GHES ──────────────────────┐
│ GitHub App installation                          │
│ webhook ─ PR metadata ─ Git HTTPS ─ PR comment   │
└─────────┬───────────────────────────────▲────────┘
          │ signed webhook                │ App token
          ▼                               │
┌──────────────── Ingress/API ────────────┴────────┐
│ webhook validator / auth / tenant authorization  │
│ report API / chat API / admin API / audit        │
└──────────────┬───────────────────────┬────────────┘
               │                       │
        ┌──────▼──────┐         ┌──────▼──────────┐
        │ Queue       │         │ PostgreSQL      │
        │ retry/dedupe│         │ tenant/report   │
        └──────┬──────┘         │ chat/audit      │
               │                └─────────────────┘
        ┌──────▼──────────────────────────────────┐
        │ Analysis workers                        │
        │ clone manager / workspace / analyzers   │
        │ review engine / report renderer         │
        └──────┬───────────────────┬──────────────┘
               │                   │
     ┌─────────▼─────────┐  ┌──────▼─────────────┐
     │ Encrypted storage │  │ LLM provider       │
     │ reports/artifacts │  │ auto review/chat   │
     └───────────────────┘  └────────────────────┘

Browser → HTTPS Web App → report/chat API
         └→ optional browser extension enhancement
```

### 4.1 구성 요소

| 구성 요소 | 책임 |
|---|---|
| Webhook ingress | raw body 서명 검증, delivery dedupe, 빠른 `202` 응답 |
| Job orchestrator | debounce, idempotency, retry, cancellation, stale 판정 |
| GitHub App adapter | installation token, PR metadata, Git fetch, comment/check write-back |
| Clone manager | run별 독립 clone, progressive deepen, SHA 검증, quota |
| Workspace manager | tenant/run별 volume·sandbox 격리와 cleanup |
| Analysis engine | diff/static/impact/merge simulation/LLM review |
| Report service | immutable revision, finding/evidence/coverage 제공 |
| Chat service | snapshot-bound retrieval, tool policy, streaming 응답 |
| Identity service | username/password, session, tenant membership, admin |
| Web app | report, code evidence, chat, settings, audit-visible 상태 |
| Browser extension | GHES/report route 감지, side panel, deep link enhancement |

MVP는 modular monolith API와 별도 worker process로 시작한다. queue와 database는
분리하되 GitHub adapter, report, auth, chat을 처음부터 microservice로 쪼개지 않는다.
부하와 보안 경계가 확인된 뒤 worker pool과 LLM gateway만 독립 확장한다.

## 5. GitHub App 및 webhook 연동

### 5.1 GitHub App 권한

권장 최소 repository permission:

- Metadata: read
- Contents: read
- Pull requests: read
- Issues 또는 Pull requests: write — PR issue comment 생성/수정
- Checks: write — Check Run을 사용할 때만

구독 event:

- Pull request
- Push — base branch 변경 재분석을 지원할 때
- Check run — GitHub UI의 re-run/requested action을 지원할 때
- Installation 및 installation repositories — repository scope 동기화

GitHub App installation access token은 installation에 허용된 repository와
permission 범위 안에서만 사용한다. Git HTTP 접근에도 installation token을
사용하고, token을 persisted remote URL, command log 또는 report에 넣지 않는다.

### 5.2 Webhook 검증

1. reverse proxy가 변경하기 전 raw request body를 보존한다.
2. `X-Hub-Signature-256` HMAC-SHA256을 constant-time 비교한다.
3. `X-GitHub-Delivery`를 unique key로 저장해 replay/중복 처리를 막는다.
4. event/action과 payload schema를 allowlist로 검증한다.
5. repository/install ID를 tenant의 installation mapping으로 다시 확인한다.
6. queue에 durable event를 기록한 후 GHES timeout 전에 `202`를 반환한다.

IP allowlist는 보조 통제일 뿐 signature 검증을 대체하지 않는다. secret은 tenant
또는 installation별 vault에 보관하고 rotation 중에는 current/previous secret을
짧은 기간 함께 검증할 수 있게 한다.

### 5.3 PR comment와 Check Run

PR comment는 매 분석마다 새로 만들지 않고 하나를 upsert한다.

```markdown
<!-- commit-defender:installation=42:repo=991:pr=128 -->
## Commit Defender

✅ Analysis completed for `head abc1234` against `base def5678`

- Grade: B
- Blocking findings: 1
- Warnings: 4
- Coverage: repository impact L2

[Open full report](https://commit-defender.intra/t/acme/reports/01J...)

_Updated 2026-09-02 14:32 KST · analysis revision 3_
```

- hidden marker로 기존 bot comment ID를 복구하고 DB에도 binding을 저장한다.
- queued/running 동안 comment를 반복 수정하지 않고 Check Run 또는 하나의 간단한
  pending 상태만 사용한다.
- comment 생성 실패가 report 생성을 실패로 바꾸지는 않는다. 별도 retry한다.
- comment body에는 source, prompt, secret, 상세 취약 code를 넣지 않는다.
- report URL은 opaque ID를 사용하지만 URL 자체를 인증 수단으로 취급하지 않는다.

Check Run은 상태 가시성과 재실행 UX가 더 좋지만 write API는 GitHub App을 전제로
한다. MVP는 comment upsert를 필수로 하고 Check Run은 같은 analysis state를
표현하는 권장 옵션으로 둔다.

## 6. PR별 독립 clone 및 workspace 설계

### 6.1 저장 구조와 tenancy 경계

```text
<data-root>/
  tenants/<tenant-uuid>/
    jobs/<analysis-run-uuid>/
      repository/       # 독립 .git/object/refs/config/index
      artifacts/
```

filesystem path에는 tenant slug, owner, repository name, PR title처럼 외부 입력을
직접 사용하지 않는다. server가 생성한 tenant UUID와 analysis run UUID만 사용한다.
각 run은 별도 volume, OS/container identity, mount namespace와 quota를 가진다.

격리는 다음 네 경계를 같은 `tenant_id`로 묶어 강제한다.

```text
DB authorization + repository grant
  ↕
GitHub App installation/repository scope
  ↕
tenant/run 전용 volume + worker identity
  ↕
report/chat retrieval namespace
```

queue에는 외부 clone URL이나 path 대신 `tenant_id`, internal repository ID,
installation ID, verified base/head SHA만 넣는다. worker는 clone 전에 DB grant와
GitHub App installation scope를 다시 확인한다.

### 6.2 독립 clone lifecycle

1. webhook/API의 repository ID, PR 번호, base/head SHA를 저장한다.
2. tenant/run 전용 빈 volume과 rootless sandbox를 만든다.
3. server가 allowlisted GHES instance와 repository ID로 HTTPS Git URL을 조립한다.
4. short-lived GitHub App installation token으로 repository를 독립 clone한다.
5. exact base/head commit을 fetch하고 object ID를 webhook/API 값과 재검증한다.
6. merge-base, canonical diff, base/head tree와 merge simulation을 계산한다.
7. 분석 결과와 필요한 evidence만 artifact storage로 옮긴다.
8. 성공·실패·취소 모든 경로에서 clone volume 전체를 삭제한다.

token을 persisted remote URL, `.git/config`, command log나 process argument에
넣지 않는다. ephemeral credential helper/askpass와 redaction을 사용하고 clone 직후
remote credential state를 제거한다.

### 6.3 긴 history를 제한하는 progressive fetch

PR별 독립 clone은 유지하되 initial transfer를 제한한다.

```text
git clone --no-checkout --filter=blob:none --no-tags --depth=<initial-depth> <url>
git fetch --filter=blob:none --no-tags origin <base-ref> <pr-head-ref>
```

실제 command와 refspec은 대상 GHES/Git version spike 후 고정한다. 임의 ref나 URL을
job payload에서 받지 않는다.

merge-base 탐색 정책:

1. initial depth에서 `merge-base(baseSha, headSha)`를 찾는다.
2. 없으면 depth를 `50 → 200 → 1000`처럼 단계적으로 deepen한다.
3. tenant가 정한 history commit/byte/time hard limit에서 중단한다.
4. 끝까지 찾지 못하면 임의 2-dot diff로 대체하지 않는다.
5. GHES가 제공한 PR diff를 검증된 fallback으로 사용하고 report를 `partial`로
   표시하거나 정책에 따라 분석을 실패시킨다.

`blob:none` clone에서도 분석 대상 working tree를 checkout할 때 필요한 blob은
가져오게 된다. history object 수와 모델 입력량은 별개다. 모델 context에는 다음만
포함한다.

- canonical PR diff
- 변경 파일의 필요한 base/head 영역
- symbol/reference 탐색으로 관련성이 확인된 기존 파일
- merge simulation과 static analyzer 결과

commit message 전체나 unrelated historical diff를 자동으로 prompt에 넣지 않는다.

### 6.4 Analysis workspace

하나의 독립 repository 안에서 exact SHA를 사용한다.

```text
run-private repository
  ├─ detached base view        @ exact base SHA
  ├─ detached head view        @ exact head SHA
  └─ integration view          @ exact base SHA + simulated head merge
```

구현은 repository 내부의 detached worktree를 사용할 수 있다. 이 worktree들은
동일 run 안에서만 Git state를 공유하며 다른 PR/run repository와 연결되지 않는다.

canonical PR diff는 다음 의미를 유지한다.

```text
git diff <merge-base(base, head)>..<head>
```

base branch tip과 head branch tip을 단순 2-dot diff하거나 branch name만 신뢰하지
않는다. merge simulation은 canonical diff와 별도 단계다. integration view에서
`head SHA`를 no-commit merge하거나 지원 Git 버전에서는 `git merge-tree`를 사용해
conflict와 resulting tree를 구한다. simulation 결과를 GHES에 push하지 않는다.

### 6.5 Untrusted repository 통제

PR source는 신뢰하지 않는다. worker는 기본적으로 다음을 금지한다.

- repository hook 실행
- package install 및 lifecycle script
- test/build command 자동 실행
- submodule/LFS 자동 fetch
- 외부 network access
- host filesystem 및 container socket mount
- arbitrary executable/path/URL 입력

Git 실행 시 system/global config를 격리하고 server-controlled repository config만
사용한다. 동적 검사가 후속 단계에서 필요하면 disposable sandbox, read-only source,
egress deny, CPU/memory/PID/time quota를 적용한 별도 worker class에서만 실행한다.

### 6.6 Cleanup과 retention

- PR/run 독립 clone과 모든 내부 worktree: 성공·실패·취소 후 즉시 삭제
- raw unified diff 및 selected context: tenant 정책 TTL 후 삭제
- immutable report: 기본 90일, tenant별 설정
- chat: 기본 30일, report보다 길게 보존하지 않음
- audit log: 조직 정책에 따라 별도 장기 retention

cleanup은 job `finally`뿐 아니라 orphan sweeper가 반복 수행한다. 삭제 실패는
감사 event와 metric을 남기고 quarantine 후 재시도한다.

## 7. 분석 pipeline

### 7.1 단계

1. PR metadata와 exact SHA 검증
2. repository policy와 exclude rule 로드
3. merge-base와 canonical changed set 계산
4. base/head 변경 파일 및 symbol 추출
5. base repository caller/importer/consumer 후보 탐색
6. merge simulation과 conflict/resulting-tree 검사
7. 언어별 static analyzer 실행
8. bounded context를 LLM review에 전달
9. finding schema 검증, 중복 제거, priority policy 적용
10. report/coverage 저장
11. stale 확인 후 GitHub write-back

### 7.2 결과 계약

```ts
interface AnalysisRevision {
  id: string;
  tenantId: string;
  repositoryId: string;
  pullRequestNumber: number;
  baseSha: string;
  headSha: string;
  mergeBaseSha: string;
  status: 'completed' | 'partial' | 'failed' | 'superseded';
  summary: string;
  grade: string;
  findings: Finding[];
  impact: ImpactReport;
  mergeSimulation: {
    status: 'clean' | 'conflicted' | 'not_run';
    conflicts: string[];
    limitations: string[];
  };
  coverage: {
    filesChanged: number;
    filesExamined: number;
    filesSkipped: number;
    truncated: boolean;
    limitations: string[];
  };
  engineVersion: string;
  policyVersion: string;
  createdAt: string;
}
```

finding은 가능한 경우 changed line에 귀속한다. 변경되지 않은 base code의 파급
가능성은 별도 impact evidence로 표시해 PR 작성자가 직접 수정하지 않은 코드에
오해를 부르는 inline finding을 만들지 않는다.

### 7.3 Resource limit

| 항목 | 초기 기본값 |
|---|---:|
| PR changed files | 500 |
| raw diff | 10 MiB |
| selected source context | 25 MiB |
| LLM input | provider context의 60% 이하 |
| analysis workspace | 2 GiB soft / 4 GiB hard |
| automatic analysis timeout | 15분 |
| chat tool turn | 8회 |
| chat request timeout | 3분 |

초과 시 무조건 실패시키기보다 `partial` report와 정확한 limitation을 반환한다.
binary/generated/vendor/lockfile은 정책에 따라 요약 또는 제외한다.

## 8. Report web app과 browser extension

### 8.1 Report URL

```text
https://commit-defender.intra/t/<tenant-slug>/reports/<opaque-report-id>
```

- URL에 username, repository credential, SHA 이외의 secret을 넣지 않는다.
- 미인증 사용자는 login 후 검증된 relative `return_to`로 돌아온다.
- 로그인 후 tenant membership과 repository grant를 다시 확인한다.
- report ID의 추측 불가능성은 보조 통제일 뿐 authorization을 대체하지 않는다.
- report revision과 head SHA를 항상 표시한다.

### 8.2 Extension 연계

HTTPS 링크가 extension을 직접 실행하는 방식은 browser/enterprise policy와 설치
상태에 따라 불안정하다. 따라서 web app을 canonical viewer로 둔다.

extension이 설치된 경우:

- report origin의 content script가 현재 report ID를 인식한다.
- **Open in Commit Defender panel** 버튼으로 side panel을 연다.
- GHES PR tab과 report finding 사이의 file/line navigation을 연결한다.
- server session cookie 또는 짧은 one-time exchange code를 사용하고 password나
  장기 access token을 extension storage에 저장하지 않는다.

extension이 없으면 동일 HTTPS URL의 responsive web UI가 모든 report/chat 기능을
제공한다. 새 tab은 정상 link navigation으로 열고 popup은 browser blocker 때문에
핵심 흐름에 사용하지 않는다.

### 8.3 Report UI

- PR identity, base/head SHA, analysis revision, stale 상태
- grade, summary, blocking/warning count
- changed-line findings와 repository impact 분리
- file/category/priority filter
- evidence code viewer와 GHES source link
- merge simulation 결과
- coverage와 제외/절단 사유
- Markdown/JSON export
- authorized re-run button
- user-specific chat panel

## 9. On-demand chat 설계

### 9.1 Snapshot binding

모든 chat session은 `analysis_revision_id`, `base_sha`, `head_sha`에 고정한다.
새 분석이 나오더라도 기존 대화의 근거를 몰래 바꾸지 않는다. UI에서 최신
revision으로 새 chat을 시작하도록 안내한다.

### 9.2 허용 tool

- 현재 report/finding 조회
- base/head의 특정 파일·line 조회
- symbol definition/reference 검색
- dependency/import graph 조회
- canonical diff와 merge simulation 조회
- 필요 시 bounded supplementary static analysis

LLM이 임의 shell, Git ref, filesystem path, URL 또는 database query를 생성해
실행하지 못하게 한다. tool argument는 tenant/repository/snapshot에 server가
강제로 scope하고 path traversal과 symlink escape를 검증한다.

### 9.3 Chat 요청 흐름

```text
authenticated user message
  → tenant/report authorization
  → prompt injection/security filter와 size limit
  → report summary + user prompt + selected evidence
  → 필요 시 allowlisted retrieval tool
  → LLM provider
  → SSE stream
  → citations(file/line/revision) 포함 응답 저장
```

사용자별 custom prompt는 tenant policy가 허용한 영역에서만 적용한다. system
security policy, output schema, tool restrictions는 사용자가 덮어쓸 수 없다.

### 9.4 LLM credential

비동기 webhook 분석과 remote chat에는 다음 순서를 권장한다.

1. 조직 공용 service credential — MVP
2. tenant별 provider credential — 비용/정책 분리가 필요할 때
3. 사용자 BYOK — 명시적 요구가 있을 때만

credential은 vault/KMS에 저장하고 browser, report, DB 평문 column, log에 남기지
않는다. provider별 request에는 tenant/user/run correlation ID만 넣고 source나
prompt 원문을 application log에 기록하지 않는다. 사용자 로컬 CLI sign-in은
선택적인 extension-local ad-hoc review에는 쓸 수 있지만 server automation의
credential로 재사용하지 않는다.

## 10. Identity, tenancy와 authorization

### 10.1 Tenant 모델

사용자별 격리를 지원하되 repository 분석 자체를 사용자마다 중복 실행하지 않는다.

- `Tenant`: GHES installation/repository/policy/billing/retention 경계
- `User`: username/password로 로그인하는 사람
- `Membership`: tenant 내 `owner|admin|reviewer|viewer` role
- `RepositoryGrant`: membership이 접근할 수 있는 repository 범위
- `PersonalWorkspace`: 사용자 prompt, chat, saved filter의 private 영역

“사용자별 tenancy”를 엄격히 요구하면 가입 시 personal tenant를 자동 생성할 수
있다. 다만 한 PR을 여러 사용자가 보는 조직 환경에서는 immutable analysis
revision은 tenant 안에서 한 번만 만들고, chat/prompt/history만 `user_id`로
격리하는 편이 비용과 일관성 측면에서 권장된다.

### 10.2 Username/password 인증

- username은 tenant 안에서 unique; login에는 tenant slug도 요구
- password는 Argon2id로 salt를 포함해 hash하고 평문/복호화 가능한 형태로 저장 금지
- 최소 길이, 유출 password blocklist, rate limit과 progressive backoff
- session ID는 rotation 가능한 opaque random 값
- cookie는 `Secure`, `HttpOnly`, `SameSite=Lax` 이상
- state-changing request에는 CSRF token과 Origin 검증
- login/logout/password 변경/session revoke/audit 기록
- admin 초대 기반 가입을 기본으로 하고 public self-signup 비활성화
- password reset은 사내 mail 또는 admin-issued single-use token으로 제한
- MFA/WebAuthn과 사내 SSO 연동은 production hardening 단계에서 추가

### 10.3 Authorization 원칙

모든 request는 다음 교집합을 만족해야 한다.

```text
authenticated user
∩ active tenant membership
∩ repository grant
∩ report/chat action role
∩ GitHub App installation repository scope
```

tenant slug나 report ID만으로 tenant를 결정하지 않는다. application query는 항상
`tenant_id` predicate를 강제하고 PostgreSQL RLS를 defense in depth로 사용한다.
cache key, object storage prefix, queue payload, metrics label에도 tenant ID를
명시한다. 서로 다른 tenant 사이의 clone workspace, report context와 chat retrieval을
공유하지 않는다.

## 11. 데이터 모델

| Entity | 주요 field |
|---|---|
| `tenants` | id, slug, status, retention_policy |
| `users` | id, username, password_hash, status |
| `memberships` | tenant_id, user_id, role |
| `ghes_instances` | tenant_id, base_url, app_id, secret_refs |
| `installations` | tenant_id, ghes_id, installation_id, status |
| `repositories` | tenant_id, installation_id, github_repo_id, owner, name |
| `repository_grants` | tenant_id, user_id/role, repository_id |
| `pull_requests` | repository_id, number, current_base_sha, current_head_sha |
| `webhook_deliveries` | delivery_id, event, action, payload_hash, status |
| `analysis_runs` | id, PR, SHAs, idempotency_key, state, versions |
| `reports` | opaque_id, analysis_run_id, revision, summary, artifact_ref |
| `findings` | report_id, file, line, priority, category, evidence |
| `comment_bindings` | PR, GitHub comment_id, last_report_id |
| `chat_sessions` | tenant_id, user_id, analysis_revision_id, title |
| `chat_messages` | session_id, role, content_ref, citations, token_usage |
| `audit_events` | tenant_id, actor, action, resource, outcome, timestamp |

webhook raw payload는 troubleshooting TTL 이후 삭제하거나 필요한 field만 정규화해
보존한다. source artifact는 database row에 직접 넣기보다 암호화된 object storage에
두고 tenant-bound object key와 integrity hash를 저장한다.

## 12. API 초안

```text
POST   /webhooks/github
POST   /auth/login
POST   /auth/logout
GET    /api/v1/me
GET    /api/v1/reports/{reportId}
GET    /api/v1/reports/{reportId}/findings
POST   /api/v1/reports/{reportId}/rerun
POST   /api/v1/reports/{reportId}/chat-sessions
GET    /api/v1/chat-sessions/{sessionId}
POST   /api/v1/chat-sessions/{sessionId}/messages
DELETE /api/v1/chat-sessions/{sessionId}
GET    /api/v1/analyses/{analysisId}/events
```

chat streaming은 MVP에서 SSE를 사용한다. 양방향 realtime tool control이 실제로
필요해질 때 WebSocket을 검토한다. mutation endpoint는 idempotency key와 CSRF
검증을 요구한다.

## 13. 보안 및 운영

### 13.1 Network zone

- ingress proxy/WAF: 사용자 web과 GHES webhook endpoint
- application zone: API, report, auth, chat
- worker zone: Git/analysis sandbox
- data zone: PostgreSQL, queue, object storage, ephemeral clone volumes, vault
- egress: allowlisted GHES와 LLM provider만 허용

webhook endpoint와 사용자 endpoint는 routing/rate limit을 분리한다. 내부 서비스
간에는 mTLS 또는 workload identity를 사용한다.

### 13.2 Secret

- GitHub App private key
- webhook secret
- installation token cache
- LLM provider credential
- session signing/encryption key
- object storage/database credential

secret은 vault/KMS에 두고 rotation runbook을 제공한다. Git command line, process
list, exception, tracing span과 support bundle에 token이 노출되지 않게 redaction
test를 둔다.

### 13.3 감사 event

- login 성공/실패, logout, password/session 변경
- tenant/member/repository grant 변경
- webhook accept/reject/replay
- clone/fetch와 분석 시작/완료/실패/취소
- report 조회/export/rerun
- GitHub comment/check 생성·수정
- chat 생성/질문/tool 접근/provider 호출
- admin configuration 및 secret rotation

prompt/source/chat 원문은 audit log에 넣지 않고 ID, hash, size, outcome만 기록한다.

### 13.4 관측성

- webhook acceptance latency와 signature failure
- queue depth, oldest job age, retry/dead-letter count
- clone/fetch duration, transferred bytes와 workspace size
- workspace quota와 orphan cleanup
- analyzer별 duration/failure/coverage
- LLM latency/token/error/cost by tenant
- report publish 및 comment update failure
- auth failure/rate limit/authorization denial

## 14. 장애 및 재시도 정책

| 실패 | 처리 |
|---|---|
| webhook 중복 | delivery ID로 성공 응답, job 중복 생성 안 함 |
| GHES 일시 오류 | exponential backoff + jitter |
| installation 권한 제거 | terminal failure, tenant admin에 안내 |
| fetch 중 head 변경 | run superseded, 최신 SHA job 우선 |
| worker 종료 | lease 만료 후 재queue, workspace sweeper |
| LLM timeout/rate limit | bounded retry, partial report 가능 |
| report 저장 성공/comment 실패 | report 유지, publish만 재시도 |
| DB/queue 장애 | webhook durable 기록 불가 시 non-2xx로 GHES redelivery 유도 |
| disk quota 초과 | 신규 job backpressure, 완료 clone cleanup, artifact TTL 정리 |

재시도는 동일 idempotency key와 analysis run을 사용하며 comment를 중복 생성하지
않는다. dead-letter job은 tenant admin UI에서 원인과 안전한 rerun을 제공한다.

## 15. 단계별 구현 계획

### Phase 0 — 환경 검증

- 대상 GHES version과 GitHub App 지원 범위 확인
- webhook network route/TLS/secret 검증
- installation token으로 private repository fetch spike
- PR comment 생성/수정 및 optional Check Run spike
- fork PR, large repo, LFS/submodule, base branch update 조사
- 조직 LLM provider credential과 source 전송 정책 확인

완료 조건: 샘플 private PR에서 webhook → exact SHA fetch → comment round trip 성공.

### Phase 1 — Identity 및 tenant foundation

- PostgreSQL schema, tenant-scoped repository layer, RLS
- username/password, secure session, CSRF, rate limit
- tenant/member/repository grant admin
- vault integration과 audit event

완료 조건: cross-tenant negative test와 session security test 통과.

### Phase 2 — GitHub ingestion과 queue

- GitHub App installation mapping
- webhook raw signature 검증과 delivery dedupe
- PR event state machine, debounce, idempotency, reconciliation
- durable queue, retry/dead-letter, cancellation

완료 조건: opened/synchronize/reopened event가 중복 없이 job을 생성.

### Phase 3 — PR별 clone/workspace 및 deterministic diff

- tenant/run별 독립 clone manager
- blobless/shallow initial fetch와 bounded progressive deepen
- exact base/head fetch와 object validation
- run별 base/head/integration workspace
- canonical diff와 merge simulation
- volume quota, cleanup, orphan sweeper

완료 조건: 동일 SHA 재실행 결과가 같고 concurrent PR workspace가 격리됨.

### Phase 4 — Analysis/report MVP

- 기존 Commit Defender review core와 static analyzer adapter
- repository impact candidate search
- server-side LLM provider adapter와 structured report
- immutable report revision과 responsive web viewer
- partial/coverage/stale 표현

완료 조건: 실제 PR에 대해 전체 report를 인증된 web UI에서 조회.

### Phase 5 — GitHub write-back

- single PR comment upsert와 hidden marker recovery
- publish retry 및 current-head guard
- optional Check Run 상태/summary/re-run
- report deep link와 권한 오류 UX

완료 조건: 새 commit마다 comment 한 개가 최신 revision으로 안전하게 갱신됨.

### Phase 6 — On-demand chat

- snapshot-bound chat session/message
- allowlisted code/report retrieval tools
- SSE streaming, citation, token/quota limit
- 사용자 prompt와 tenant policy layering
- retention/delete/audit

완료 조건: 사용자가 report 근거와 file/line citation이 있는 후속 답변을 받음.

### Phase 7 — Browser extension integration

- GHES PR/report route detector
- web session 기반 side panel open
- finding → GHES file/line navigation
- extension 미설치 web fallback
- managed enterprise deployment

완료 조건: 같은 report link가 extension 설치/미설치 환경에서 모두 동작.

### Phase 8 — Production hardening

- sandboxed dynamic analysis 선택 기능
- HA, backup/restore, disaster recovery
- secret rotation, penetration test, supply-chain scan
- MFA/SSO, data retention automation
- capacity/load test와 tenant별 quota/cost controls

## 16. 테스트 전략

### 16.1 기능

- 모든 trigger action과 base branch push 재분석
- SHA 고정, merge-base diff, merge conflict simulation
- comment create/update/recovery와 stale publish 차단
- report login/return-to/authorization
- chat snapshot/citation/tool limit
- extension 설치 및 미설치 link 흐름

### 16.2 보안

- invalid/replayed webhook와 timing-safe signature test
- tenant/repository/report/chat horizontal privilege escalation
- path traversal, symlink escape, malicious ref/repository name
- Git hook, smudge filter, submodule, LFS, package script 비실행
- SSRF, arbitrary Git remote, command injection
- password brute force, session fixation, CSRF, open redirect
- secret/log/process-list leakage
- prompt injection을 통한 cross-repository retrieval 시도

### 16.3 성능과 복구

- 동일 repository 다중 PR concurrent fetch
- 대형 monorepo와 quota 초과 partial report
- webhook burst와 synchronize debounce
- worker kill, queue redelivery, orphan cleanup
- GHES/LLM 장애와 backoff
- DB backup restore 후 comment/report binding 복구

## 17. 수용 기준

- PR 생성 후 webhook이 검증되고 설정된 SLA 안에 분석이 시작된다.
- 분석은 webhook/API에서 고정한 exact base/head SHA를 사용한다.
- PR별 workspace는 격리되며 종료 후 삭제된다.
- PR/run별 `.git`, object database, refs와 config가 다른 run과 공유되지 않는다.
- canonical PR diff와 merge simulation 결과가 구분되어 표시된다.
- 최신 head가 아닌 run은 PR comment를 덮어쓰지 않는다.
- PR에는 중복 없이 하나의 bot comment와 인증된 report link가 유지된다.
- report link는 extension 없이도 web app에서 열린다.
- username/password와 tenant/repository authorization 없이는 report를 볼 수 없다.
- chat은 선택한 analysis revision만 근거로 하고 file/line citation을 제공한다.
- cross-tenant source/report/chat 접근 테스트가 모두 거부된다.
- repository code는 기본 worker에서 실행되지 않는다.
- source, password, GitHub/LLM token이 log와 PR comment에 남지 않는다.

## 18. 구현 전 확정할 항목

1. 대상 GHES exact version과 GitHub App 설치 권한
2. tenant 단위: 조직/부서/개인 중 무엇을 primary boundary로 할지
3. 사용자와 GHES repository grant를 누가 어떻게 매핑할지
4. server-side LLM credential: 조직 공용, tenant별, BYOK 중 MVP 선택
5. report/chat/source retention과 ephemeral clone disk quota
6. Check Run 사용 여부와 merge gate 연계 시점
7. fork PR 및 외부 contributor 정책
8. static-only MVP와 sandboxed test/build의 후속 범위
9. 예상 repository 수, 최대 크기, PR 빈도, 동시 worker 수
10. 사내 DNS/TLS, reverse proxy, mail/password reset 인프라

## 19. 권장 MVP 범위

- 단일 GHES instance
- 사내 private GitHub App
- 조직 단위 tenant + 사용자별 personal workspace
- username/password 및 admin invite
- Contents read, Pull requests read, Issues/PR comment write
- `opened|reopened|synchronize|ready_for_review` 자동 분석
- tenant/run별 독립 clone + clone 내부 isolated base/head/integration view
- blobless/shallow initial fetch + bounded progressive deepen
- static analysis + L2 repository impact + server-side LLM review
- immutable web report + single PR comment upsert
- 조직 공용 LLM credential
- report-bound SSE chat와 read-only retrieval tools
- browser extension은 report/PR navigation enhancement만 담당
- Check Run, inline review, dynamic build/test, SSO/MFA는 후속 단계

## 20. 기존 serverless 설계와의 관계

기존 `github-enterprise-browser-extension-design.md`는 중앙 서버가 없는 개인/소규모
사용 대안으로 유지한다. 본 문서는 자동 webhook 분석, 공유 repository context,
PR write-back, remote report/chat, multi-tenancy가 필요한 enterprise 기본안이다.
두 모드를 하나의 MVP에서 동시에 구현하지 않는다.

## 21. 참고 자료

- [GitHub Enterprise Server webhook event/payload](https://docs.github.com/en/enterprise-server@3.20/webhooks/webhook-events-and-payloads)
- [Webhook delivery signature 검증](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Webhook 운영 권장 사항](https://docs.github.com/en/enterprise-server@3.20/webhooks/using-webhooks/best-practices-for-using-webhooks)
- [GitHub App installation 인증과 Git access](https://docs.github.com/en/enterprise-server@3.20/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [GitHub App user authorization](https://docs.github.com/en/enterprise-server@3.20/apps/using-github-apps/authorizing-github-apps)
- [PR/issue comment REST endpoint](https://docs.github.com/en/enterprise-server@3.17/rest/issues/comments)
- [Check Runs REST endpoint](https://docs.github.com/en/enterprise-server@3.20/rest/checks/runs)
- [Checks API 사용 가이드](https://docs.github.com/en/enterprise-server@3.20/rest/guides/using-the-rest-api-to-interact-with-checks)
- [Git clone 옵션과 shallow/partial clone](https://git-scm.com/docs/git-clone)
- [Git object 연결성과 무결성 검증](https://git-scm.com/docs/git-fsck)
