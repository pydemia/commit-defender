# 플랫폼별 설치와 검증 범위

2.12.6은 다음 VSIX를 제공한다. `x64`는 `amd64`와 같은 아키텍처다.
VS Code가 실행되는 OS/CPU에 맞는 파일을 **Install from VSIX…**로 선택한다.
Remote SSH로 Linux에서 extension을 실행한다면 Linux 쪽 조건이 적용된다.

| OS | ARM64 | x64 / amd64 |
| --- | --- | --- |
| Windows | `commit-defender-2.12.6-win32-arm64.vsix` | `commit-defender-2.12.6-win32-x64.vsix` |
| macOS | `commit-defender-2.12.6-darwin-arm64.vsix` | `commit-defender-2.12.6-darwin-x64.vsix` |
| Linux | `commit-defender-2.12.6-linux-arm64.vsix` | `commit-defender-2.12.6-linux-x64.vsix` |

`npm ci` 후 `npm run package:platforms`로 생성하며 결과는
`test-results/packages-2.12.6/`에 저장된다. 같은 파일을 덮어쓰지 않는다.
동봉된 Windows helper는 Windows에서만 실행한다. JavaScript bundle과 공통
package는 동일하고 VSIX의 target metadata가 다르다.

## Linux Codex 계정

1. Linux 사용자 환경에서 지원되는 Codex CLI `0.153.4` 또는 `0.154.0`과
   기존 로그인을 준비한다. 다른 장비의 인증 파일을 복사하지 않는다.
2. VS Code User Settings에서 Codex 실행 파일, 계정에 있는 model과 지원되는
   reasoning effort를 선택한다. 검증 예시는 `gpt-5.6-luna / high`다.
3. Linux Secret Service와 `/usr/bin/secret-tool`을 사용할 수 있어야 한다.
   이는 extension의 암호화 저장소에 필요하며 Codex 로그인과 별개다.
4. 작은 변경으로 **Analyze Staged Files**를 실행하고 최종 상태, source 근거와
   저장된 결과 재조회를 확인한다. 자동 리뷰는 별도 opt-in이다.

Linux executor는 기존 `CODEX_HOME`의 `auth.json`과 동일한 inode를 임시
0700 directory에 hard link로 노출한다. 인증 내용은 복사하지 않는다.
원본은 현재 사용자 소유의 일반 파일이어야 하고 다른 사용자에게 접근 권한이
없어야 한다. Codex home은 다른 사용자가 쓸 수 없어야 하며 symlink home이나
auth 파일은 허용하지 않는다. 파일 시스템이 hard link를 지원해야 한다.

keyring에만 저장된 Codex 로그인은 이 경로에서 사용할 수 없다. 이를 통과시키기
위해 keyring credential을 평문으로 내보내거나 사용자 설정을 변경하지 않는다.
기존 Codex 파일 저장 방식의 token 갱신은 같은 inode에 반영된다. 전역 지침·설정은
임시 home에 포함하지 않고 실행 종료·취소·timeout 후 임시 링크를 제거한다.

## 확인한 범위

| 조합 | 근거와 남은 확인 |
| --- | --- |
| Windows ARM64 | W01–W04 native 계정 리뷰·보안·service 근거. 새 executor에서도 실제 CLI 합성 도구 검사를 통과했다 |
| Windows x64 | package target 제공. x64 장비 native 실행은 미검증 |
| macOS ARM64 | W04에서 기존 공통 package를 native 검증. 이번 변경은 Linux 분기에 한정하며 새 VSIX Host는 미검증 |
| macOS x64 | package target 제공. Intel Mac 실행은 미검증 |
| Linux ARM64 | WSL2 Ubuntu 24.04.1, VS Code 1.137.0/Node 24.18.1 Host, Codex 0.153.4, Luna/high 실제 리뷰 1회 완료. 결함·근거·암호화 결과 재조회·정리 통과. 별도 Docker 격리·process 25개 검사 통과 |
| Linux x64 | ARM64 PC의 Docker 에뮬레이션에서 Node 22.23.2/Codex 0.153.4 합성 도구 검사 통과. x64 native 장비 검증과 구분 |

Linux 실제 리뷰는 Windows ARM64 PC의 WSL2에서 수행했다. WSL을 사용하지
않는 Linux desktop과 x64 장비의 실제 계정 리뷰는 별도로 검증하지 않았다.
Linux 자동 service를 경유한 실제 모델 호출도 이번 검증 범위에는 없다.
합성 검사는 모델에게 결함을 판단시킨 증거가 아니다. target 이름이나 AnyCPU
helper만으로 해당 OS/CPU 전체 지원이 검증된 것으로 해석하지 않는다.

현재 Marketplace의 2.12.5는 Windows ARM64다. 개발 후보 생성·로컬 설치·실행 중인
Host·service·Marketplace 버전은 서로 다를 수 있다. 사용자 Host를 강제로
재로드하거나 기존 service를 임의로 교체하지 않는다.
