# 붙여봄

PDF에서 복사해 끊어진 글의 줄을 확인하며 잇는 작은 브라우저 도구입니다. 글의 내용이나 어조를 다시 쓰지 않습니다. 추천하는 연결도 사용자가 적용해야 결과에 반영됩니다.

[브라우저에서 사용하기](https://a123qsd.github.io/butyeobom/) · [이용 조건](LICENSE) · [오류·개선 제안 및 이용 허락 문의](https://github.com/a123qsd/butyeobom/issues)

상단의 **한국어 / English**에서 화면 언어를 바꿀 수 있습니다. 화면 언어와 관계없이 한국어·영어 텍스트를 처리하며, 전환 중에도 입력·연결 선택·되돌리기 기록을 유지합니다.

개인·학교·회사 내부 업무에 무료로 사용할 수 있습니다. 프로그램 자체 판매와 외부 이용자에게 프로그램 기능을 유료로 제공하는 경우에는 사전 허락이 필요합니다.

## English

**Butyeobom — Clean up text copied from PDFs**

Butyeobom is a free, browser-based tool that helps tidy up unwanted line breaks in text copied from PDFs. It supports Korean and English text, with a choice of Korean or English for the interface.

Use **한국어 / English** at the top of the page to switch the interface language. Switching keeps your text, selected changes, and undo history. The interface language does not change how your text is processed.

Paste your text, review the suggested changes, and choose which lines to join. For words split across lines with a hyphen, you can decide whether to keep or remove the hyphen. Compare the result with the original, undo changes, and copy the cleaned text.

It uses rules rather than AI rewriting. Your text is processed in your browser and is not sent to a server or automatically saved by the app. No account or installation is required.

Personal, educational, and internal business use is free. Selling the program or offering its functionality as a paid service requires prior permission under the [project’s license](LICENSE).

[Try Butyeobom in English](https://a123qsd.github.io/butyeobom/?lang=en)

## 사용 흐름

화면 상단에서 **한국어** 또는 **English**를 선택합니다. 영어 화면을 바로 열려면 주소에 `?lang=en`을 붙일 수 있습니다.

1. 원문을 붙여 넣고 **연결 제안 보기**를 누릅니다.
2. 추천 연결을 적용하거나, 줄마다 원문 유지·연결을 선택합니다.
3. 영어 줄 끝 하이픈은 원문 유지, 하이픈을 남겨 연결, 하이픈을 지워 연결 중 직접 고릅니다.
4. 원문과 결과, 강조된 변경 위치를 확인합니다. 선택을 되돌릴 수 있습니다.
5. 결과를 복사합니다. 브라우저가 복사를 허용하지 않으면 결과를 선택해 직접 복사할 수 있습니다.

새 원문을 입력하면 이전 제안과 결과는 무효화됩니다. 전체 초기화는 입력·결과·선택 기록을 비웁니다. 이미 운영체제 클립보드에 복사한 내용은 초기화로 지워지지 않습니다.

빈 입력창에 붙여 넣거나 원문 전체를 선택해 새 글을 붙여 넣으면 원래 CRLF·CR 줄바꿈을 메모리에 보존하고, **결과 복사** 버튼으로 복사할 때 유지합니다. 이후 입력창을 직접 편집하거나 일부만 붙여 넣으면 브라우저 입력창의 LF 줄바꿈을 기준으로 처리합니다. 결과를 직접 선택해 복사하는 방식의 줄바꿈은 브라우저·운영체제를 따릅니다.

## 실행과 검사

Node.js 20 이상에서 별도의 패키지 설치 없이 실행합니다.

```sh
npm start
```

터미널에 표시되는 로컬 주소를 브라우저로 엽니다. 기본 주소는 `http://127.0.0.1:4173`입니다. 다른 포트가 필요하면 `PORT=4174 npm start`처럼 지정합니다. 종료는 터미널에서 `Ctrl+C`를 누릅니다.

```sh
npm test
```

브라우저 시나리오는 `tests/browser-smoke.js`에 있습니다. 로컬 서버와 별도 Playwright CLI 세션을 실행한 뒤 `playwright-cli run-code --filename tests/browser-smoke.js`로 검사할 수 있습니다. 배포 앱에는 Playwright가 포함되지 않습니다.

언어 전환과 양쪽 화면의 흐름은 `playwright-cli run-code --filename tests/i18n-browser-smoke.js`로 검사합니다.

개발 서버는 이 컴퓨터에서만 접속할 수 있도록 루프백 주소에 바인딩합니다. `index.html`, `favicon.svg`, `src/`의 앱 자산만 제공합니다. 공개 호스팅에는 이 정적 자산만 필요합니다. 브라우저 모듈을 사용하므로 HTML 파일을 직접 더블클릭하는 방식보다 HTTP 정적 서버에서 실행해야 합니다.

검증은 순수 함수·불변성·로컬 서버 자동 검사와 Chrome의 실제 브라우저 조작으로 진행했습니다. 320·390·768·1366px 화면, 키보드 선택, 긴 입력, 반복 클릭, 되돌리기, 초기화와 복사 경합을 확인했습니다. 복사 성공·거절·지연은 브라우저 API를 검사 중에만 대체했고, CRLF 붙여넣기는 합성 이벤트로 확인했습니다. 실제 OS 클립보드 권한창, iOS·Android 기기, Safari·Firefox, 화면 읽기 프로그램의 전체 흐름은 직접 검사하지 않았습니다.

## 게시 파일 확인

`publish-manifest.json`은 저장소와 웹사이트에 포함할 파일을 각각 지정합니다. 작업 기록, 브라우저 프로필, 로그와 스크린샷은 게시 대상에 포함하지 않습니다.

```sh
npm run check:release
npm run build
```

게시 검사는 Git에 등록된 파일 목록과 실제 내용이 목록과 일치하는지, 자격증명 형태의 문자열·연락 이메일·로컬 계정 경로·심볼릭 링크가 포함됐는지 확인합니다. 자동 검색만으로 모든 민감한 내용을 찾을 수 있는 것은 아니므로 변경 내용도 직접 검토해야 합니다. 빌드는 새 `_site` 디렉터리에 허용된 웹사이트 파일 9개만 복사하며, 기존 디렉터리를 덮어쓰지 않습니다. GitHub Pages에는 `gh-pages` 브랜치의 이 정적 파일만 게시합니다.

## 개인정보와 처리 범위

- 입력은 현재 페이지의 메모리에서만 처리합니다. 앱에 서버 전송, 분석·추적, 로그인, 쿠키, 자동 저장 기능이 없습니다.
- 화면 언어는 메모리와 URL의 `lang` 값으로만 유지합니다. 입력한 글이나 연결 선택을 URL·브라우저 저장소에 넣지 않습니다.
- 외부 CDN, 웹폰트, API를 사용하지 않습니다. 페이지를 열 때 정적 파일을 불러온 뒤 변환은 브라우저 안에서 수행합니다.
- 입력창의 맞춤법 검사와 자동 완성을 끕니다. 앱은 클립보드를 자동으로 읽지 않습니다.
- **복사** 버튼을 누르면 브라우저를 통해 운영체제 클립보드에 결과를 씁니다. 브라우저·확장 프로그램·운영체제의 별도 기능은 이 앱이 제어하지 않습니다.
- 공개 사이트의 호스팅 제공자인 GitHub는 IP 주소 등 페이지 접속 정보를 처리할 수 있습니다. 앱이 입력한 글을 외부로 전송하거나 저장하지 않는다는 설명은 호스팅·브라우저·운영체제가 어떤 정보도 처리하지 않는다는 뜻이 아닙니다.

예시 문장과 테스트 자료는 창작된 비개인 텍스트입니다.

## 한계

복사된 글만으로 원래 문단이나 단어 경계를 완벽하게 알아낼 수는 없습니다. 한국어 단어 중간에서 끊긴 줄, 제목, 시, 수식, 복잡한 표와 코드는 직접 확인해야 합니다. 감지한 목록·표·코드와 빈 줄 문단은 보존하며, 애매한 연결은 자동으로 적용하지 않습니다. 단순 텍스트의 형태만으로 모든 구조를 감지할 수 있지는 않습니다.

PDF 업로드, OCR, 다단 문서의 읽기 순서 복원, AI 교정·요약은 지원하지 않습니다. 입력은 최대 100,000 UTF-16 코드 단위까지 분석합니다. 한도를 넘은 입력을 몰래 자르지 않습니다. 브라우저에 따라 이모지 한 글자가 두 단위 이상으로 계산될 수 있습니다.

## 이용 조건과 서드파티

[붙여봄 이용 조건 1.0](LICENSE)을 적용합니다. 개인·학교·회사 내부 업무, 일반 영리 업무와 결과물 판매는 무료입니다. 프로그램의 무료 복사·수정·재배포도 조건의 고지를 유지하면 허용합니다. 프로그램 사본·사용권의 판매 또는 프로그램 기능의 유료 제공은 사전 허락을 받아야 합니다. 세부 범위는 LICENSE 전문을 확인해 주세요.

이 프로젝트는 이용 조건이 있는 소스 공개 프로젝트이며 OSI 승인 오픈소스 라이선스로 표시하지 않습니다. AI를 활용해 작성한 코드의 권리 범위나 이용 제한의 집행 가능성을 보장하지 않습니다. 라이선스는 제공자가 보유하거나 허락할 수 있는 권리에 한하여 적용됩니다.

앱에는 배포되는 외부 라이브러리나 외부 이미지·폰트가 없습니다. 개발 도구와 브라우저의 권리는 각 제공자에게 있습니다. 이후 외부 구성요소를 추가하면 해당 구성요소의 라이선스를 별도로 유지해야 합니다.
