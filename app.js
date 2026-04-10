const STORAGE_KEY_V1 = "prompt-collection:v1";
const STORAGE_KEY_V2 = "prompt-collection:v2";
const PAGE_SIZE = 12;
const USE_CASE_PRESETS = ["ChatGPT", "Claude", "Gemini", "NotebookLM", "UnivAI"];
const VERSION_TYPES = {
  normal: "일반",
  variant: "변형",
  sequence: "순차",
};

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const supabaseClient = createSupabaseClient();

let toastTimer;

const state = {
  groups: loadGroups(),
  filters: {
    query: "",
    category: "all",
    tag: "all",
    useCase: "all",
  },
  page: 1,
  session: null,
  authReady: !supabaseClient,
  backendStatus: supabaseClient ? "Supabase 연결 확인 중" : "로컬 저장 모드",
  syncError: "",
};

window.addEventListener("hashchange", renderApp);

if (!window.location.hash) {
  window.location.replace("#/");
}

renderApp();

initializeBackend();

function renderApp() {
  const route = parseRoute();
  app.replaceChildren();

  if (route.name === "new") {
    renderEditor();
  } else if (route.name === "edit") {
    const group = findGroup(route.id);
    group ? renderEditor(group) : renderMissing();
  } else if (route.name === "prompt") {
    const group = findGroup(route.id);
    group ? renderDetail(group) : renderMissing();
  } else {
    renderLibrary();
  }

  app.focus({ preventScroll: true });
}

function parseRoute() {
  const hash = window.location.hash || "#/";
  const parts = hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

  if (!parts.length) {
    return { name: "library" };
  }

  if (parts[0] === "new") {
    return { name: "new" };
  }

  if (parts[0] === "edit" && parts[1]) {
    return { name: "edit", id: parts[1] };
  }

  if (parts[0] === "prompt" && parts[1]) {
    return { name: "prompt", id: parts[1] };
  }

  return { name: "library" };
}

function renderLibrary() {
  document.title = "프롬프트 라이브러리";
  app.replaceChildren();

  const taxonomy = collectTaxonomy();
  const filteredGroups = filterGroups();
  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / PAGE_SIZE));
  state.page = Math.min(Math.max(state.page, 1), totalPages);

  const startIndex = (state.page - 1) * PAGE_SIZE;
  const pageGroups = filteredGroups.slice(startIndex, startIndex + PAGE_SIZE);

  const view = createNode("section", {
    className: "library-view",
    attrs: { "aria-labelledby": "library-title" },
  });

  const hero = createNode("div", { className: "view-heading" }, [
    createNode("div", {}, [
      createNode("p", { className: "eyebrow", text: "Library" }),
      createNode("h2", { id: "library-title", text: "저장된 프롬프트" }),
      createNode("p", {
        className: "view-copy",
        text: "카드에서 분류를 훑고, 상세 화면에서 버전과 순차 프롬프트를 복사하세요.",
      }),
    ]),
    createLink("#/new", "새 프롬프트", "primary-button"),
  ]);

  const controls = renderLibraryControls(taxonomy);
  const summary = createNode("p", {
    className: "result-summary",
    text: `${filteredGroups.length}개 중 ${pageGroups.length}개 표시`,
  });
  const grid = createNode("ul", {
    className: "card-grid",
    attrs: { "aria-label": "프롬프트 그룹 목록" },
  });

  if (pageGroups.length) {
    pageGroups.forEach((group) => grid.appendChild(renderGroupCard(group)));
  } else {
    grid.appendChild(renderEmptyState());
  }

  view.append(hero, renderBackendPanel(), controls, summary, grid, renderPagination(totalPages));
  app.appendChild(view);
}

function renderBackendPanel() {
  const panel = createNode("section", {
    className: "backend-panel",
    attrs: { "aria-label": "Supabase 저장 설정" },
  });

  if (!supabaseClient) {
    panel.append(
      createNode("div", {}, [
        createNode("strong", { text: "로컬 저장 모드" }),
        createNode("p", {
          text: "supabase-config.js에 프로젝트 URL과 public key를 넣으면 로그인 기반 Supabase 저장을 사용합니다.",
        }),
      ])
    );
    return panel;
  }

  if (!state.authReady) {
    panel.append(
      createNode("div", {}, [
        createNode("strong", { text: "Supabase 확인 중" }),
        createNode("p", { text: state.backendStatus }),
      ])
    );
    return panel;
  }

  if (!state.session) {
    const form = createNode("form", { className: "auth-form" });
    const emailLabel = createNode("label", { className: "field-label", text: "이메일 로그인" });
    const emailInput = createNode("input", {
      id: "authEmail",
      type: "email",
      placeholder: "name@example.com",
      required: true,
    });
    emailLabel.appendChild(emailInput);

    const button = createNode("button", {
      className: "primary-button",
      text: "로그인 링크 받기",
      type: "submit",
    });

    form.append(emailLabel, button);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await sendLoginLink(emailInput.value.trim(), button);
    });

    panel.append(
      createNode("div", {}, [
        createNode("strong", { text: "Supabase 저장을 사용하려면 로그인해 주세요." }),
        createNode("p", {
          text: state.syncError || "이메일로 받은 링크를 열면 서버 저장소와 동기화됩니다.",
        }),
      ]),
      form
    );
    return panel;
  }

  const syncButton = createNode("button", {
    className: "ghost-button compact-button",
    text: "다시 동기화",
    type: "button",
  });
  syncButton.addEventListener("click", async () => {
    await loadRemoteGroups({ migrateLocalWhenEmpty: false });
  });

  const signOutButton = createNode("button", {
    className: "ghost-button compact-button",
    text: "로그아웃",
    type: "button",
  });
  signOutButton.addEventListener("click", signOut);

  panel.append(
    createNode("div", {}, [
      createNode("strong", { text: `${state.session.user.email || "로그인됨"}` }),
      createNode("p", { text: state.syncError || state.backendStatus }),
    ]),
    createNode("div", { className: "backend-actions" }, [syncButton, signOutButton])
  );
  return panel;
}

function renderLibraryControls(taxonomy) {
  const controls = createNode("div", { className: "filter-panel" });

  const searchLabel = createNode("label", { className: "field-label", text: "검색" });
  const searchInput = createNode("input", {
    id: "librarySearch",
    type: "search",
    value: state.filters.query,
    placeholder: "제목, 설명, 버전, 단계 본문 검색",
  });
  searchInput.addEventListener("input", () => {
    state.filters.query = searchInput.value;
    state.page = 1;
    refreshLibrary("librarySearch");
  });
  searchLabel.appendChild(searchInput);

  const categorySelect = renderSelectFilter(
    "categoryFilter",
    "카테고리",
    taxonomy.categories,
    state.filters.category,
    (value) => {
      state.filters.category = value;
      state.page = 1;
      refreshLibrary("categoryFilter");
    }
  );

  const tagSelect = renderSelectFilter(
    "tagFilter",
    "태그",
    taxonomy.tags,
    state.filters.tag,
    (value) => {
      state.filters.tag = value;
      state.page = 1;
      refreshLibrary("tagFilter");
    }
  );

  const useCaseSelect = renderSelectFilter(
    "useCaseFilter",
    "사용처",
    taxonomy.useCases,
    state.filters.useCase,
    (value) => {
      state.filters.useCase = value;
      state.page = 1;
      refreshLibrary("useCaseFilter");
    }
  );

  const resetButton = createNode("button", {
    className: "ghost-button",
    text: "필터 초기화",
    type: "button",
  });
  resetButton.addEventListener("click", () => {
    state.filters = {
      query: "",
      category: "all",
      tag: "all",
      useCase: "all",
    };
    state.page = 1;
    refreshLibrary("librarySearch");
  });

  controls.append(searchLabel, categorySelect, tagSelect, useCaseSelect, resetButton);
  return controls;
}

function renderSelectFilter(id, label, values, currentValue, onChange) {
  const wrapper = createNode("label", { className: "field-label", text: label });
  const select = createNode("select", { id });
  select.appendChild(createNode("option", { value: "all", text: "전체" }));

  values.forEach((value) => {
    const option = createNode("option", { value, text: value });
    select.appendChild(option);
  });

  select.value = values.includes(currentValue) ? currentValue : "all";
  select.addEventListener("change", () => onChange(select.value));
  wrapper.appendChild(select);
  return wrapper;
}

function renderGroupCard(group) {
  const item = createNode("li", {
    className: `prompt-card ${getCategoryToneClass(group.category)}`,
  });
  const firstVersion = group.versions[0] || createEmptyVersion();
  const previewText = getVersionPreviewText(firstVersion);
  const updatedDate = formatDate(group.updatedAt || group.createdAt);

  const category = createNode("div", { className: "category-row" }, [
    createNode("span", {
      className: "category-chip",
      text: group.category || "카테고리 없음",
    }),
  ]);

  const titleLink = createLink(
    `#/prompt/${encodeURIComponent(group.id)}`,
    group.title,
    "card-title-link"
  );
  const title = createNode("h3", { className: "card-title" });
  title.appendChild(titleLink);

  const description = createNode("p", {
    className: "card-description",
    text: group.description || "설명이 없는 프롬프트 그룹",
  });

  const preview = createNode("textarea", {
    className: "card-preview",
    value: previewText || "첫 번째 버전에 프롬프트 본문이 없습니다.",
    readOnly: true,
    rows: 7,
    attrs: { "aria-label": `${group.title} 첫 번째 버전 미리보기` },
  });

  const copyButton = createNode("button", {
    className: "copy-button",
    text: "복사하기",
    type: "button",
  });
  copyButton.addEventListener("click", () => copyPrompt(previewText, preview));

  const detailLink = createLink(
    `#/prompt/${encodeURIComponent(group.id)}`,
    "상세보기",
    "ghost-button"
  );

  const actions = createNode("div", { className: "card-actions" }, [copyButton, detailLink]);

  const tagRow = createNode("div", { className: "tag-row" });
  const visibleTags = group.tags.slice(0, 5);
  visibleTags.forEach((tag) => {
    tagRow.appendChild(createNode("span", { className: "tag-chip", text: `#${tag}` }));
  });
  if (group.tags.length > visibleTags.length) {
    tagRow.appendChild(
      createNode("span", {
        className: "tag-chip",
        text: `+${group.tags.length - visibleTags.length}`,
      })
    );
  }

  const meta = createNode("div", { className: "card-meta" }, [
    createNode("span", { text: updatedDate ? `${updatedDate} 수정` : "수정일 없음" }),
    createNode("span", { text: `${group.versions.length}개 버전` }),
  ]);

  item.append(category, title, description, preview, actions, tagRow, meta);
  return item;
}

function getVersionPreviewText(version) {
  if (!version) {
    return "";
  }

  if (version.type === "sequence") {
    return buildSequenceText(version);
  }

  return version.body || "";
}

function getCategoryToneClass(category) {
  const normalizedCategory = String(category || "").trim();
  if (!normalizedCategory) {
    return "tone-neutral";
  }

  let hash = 0;
  for (let index = 0; index < normalizedCategory.length; index += 1) {
    hash = (hash + normalizedCategory.charCodeAt(index) * (index + 1)) % 6;
  }

  return `tone-${hash + 1}`;
}

function renderEmptyState() {
  return createNode("li", { className: "empty-state" }, [
    createNode("strong", {
      text: state.groups.length ? "조건에 맞는 프롬프트가 없어요." : "아직 저장된 프롬프트가 없어요.",
    }),
    createNode("span", {
      text: state.groups.length
        ? "검색어나 필터를 바꿔 다시 찾아보세요."
        : "새 프롬프트를 눌러 첫 그룹을 만들어 보세요.",
    }),
  ]);
}

function renderPagination(totalPages) {
  const pager = createNode("nav", {
    className: "pagination",
    attrs: { "aria-label": "프롬프트 페이지 이동" },
  });

  if (totalPages <= 1) {
    return pager;
  }

  const previousButton = createNode("button", {
    className: "ghost-button compact-button",
    text: "이전",
    type: "button",
    disabled: state.page === 1,
  });
  previousButton.addEventListener("click", () => {
    state.page -= 1;
    refreshLibrary();
  });

  const nextButton = createNode("button", {
    className: "ghost-button compact-button",
    text: "다음",
    type: "button",
    disabled: state.page === totalPages,
  });
  nextButton.addEventListener("click", () => {
    state.page += 1;
    refreshLibrary();
  });

  pager.append(
    previousButton,
    createNode("span", {
      className: "page-indicator",
      text: `${state.page} / ${totalPages}`,
    }),
    nextButton
  );
  return pager;
}

function refreshLibrary(focusId) {
  renderLibrary();

  if (!focusId) {
    return;
  }

  window.requestAnimationFrame(() => {
    const nextFocus = document.getElementById(focusId);
    if (!nextFocus) {
      return;
    }

    nextFocus.focus();
    if (typeof nextFocus.setSelectionRange === "function") {
      const end = nextFocus.value.length;
      nextFocus.setSelectionRange(end, end);
    }
  });
}

function renderDetail(group) {
  document.title = `${group.title} - 프롬프트 라이브러리`;

  const view = createNode("section", {
    className: "detail-view",
    attrs: { "aria-labelledby": "detail-title" },
  });

  const heading = createNode("div", { className: "view-heading detail-heading" }, [
    createNode("div", {}, [
      createLink("#/", "라이브러리로 돌아가기", "text-link"),
      createNode("p", { className: "eyebrow", text: "Prompt Group" }),
      createNode("h2", { id: "detail-title", text: group.title }),
      createNode("p", {
        className: "view-copy",
        text: group.description || "설명이 없는 프롬프트 그룹입니다.",
      }),
    ]),
    createNode("div", { className: "heading-actions" }, [
      createLink(`#/edit/${encodeURIComponent(group.id)}`, "수정", "primary-button"),
      renderDeleteGroupButton(group),
    ]),
  ]);

  const meta = createNode("div", { className: "detail-meta" }, [
    renderMetaItem("카테고리", group.category || "없음"),
    renderMetaItem("사용처", group.useCases.length ? group.useCases.join(", ") : "없음"),
    renderMetaItem("태그", group.tags.length ? group.tags.map((tag) => `#${tag}`).join(" ") : "없음"),
    renderMetaItem("버전", `${group.versions.length}개`),
  ]);

  const versions = createNode("div", { className: "version-list" });
  group.versions.forEach((version, index) => {
    versions.appendChild(renderVersionDetail(version, index));
  });

  view.append(heading, meta, versions);
  app.appendChild(view);
}

function renderMetaItem(label, value) {
  return createNode("div", { className: "meta-item" }, [
    createNode("span", { text: label }),
    createNode("strong", { text: value }),
  ]);
}

function renderVersionDetail(version, index) {
  const item = createNode("article", { className: "version-panel" });
  const header = createNode("div", { className: "version-header" }, [
    createNode("div", {}, [
      createNode("p", { className: "eyebrow", text: `${VERSION_TYPES[version.type]} 버전` }),
      createNode("h3", { text: version.title || `버전 ${index + 1}` }),
      createNode("p", {
        className: "version-purpose",
        text: version.purpose || "목적 설명 없음",
      }),
    ]),
  ]);

  if (version.type === "sequence") {
    const copyAllButton = createNode("button", {
      className: "copy-button",
      text: "전체 순서 복사",
      type: "button",
    });
    copyAllButton.addEventListener("click", () => copyPrompt(buildSequenceText(version)));
    header.appendChild(copyAllButton);

    const steps = createNode("ol", { className: "step-list" });
    getOrderedSteps(version).forEach((step, stepIndex) => {
      const body = createNode("textarea", {
        className: "prompt-preview",
        value: step.body,
        readOnly: true,
        rows: 7,
        attrs: { "aria-label": `${step.title || `${stepIndex + 1}단계`} 프롬프트 내용` },
      });
      const copyButton = createNode("button", {
        className: "copy-button compact-button",
        text: "단계 복사",
        type: "button",
      });
      copyButton.addEventListener("click", () => copyPrompt(step.body, body));

      steps.appendChild(
        createNode("li", { className: "step-panel" }, [
          createNode("div", { className: "step-heading" }, [
            createNode("h4", { text: step.title || `${stepIndex + 1}단계` }),
            copyButton,
          ]),
          body,
        ])
      );
    });
    item.append(header, steps);
    return item;
  }

  const body = createNode("textarea", {
    className: "prompt-preview",
    value: version.body,
    readOnly: true,
    rows: 12,
    attrs: { "aria-label": `${version.title || `버전 ${index + 1}`} 프롬프트 내용` },
  });
  const copyButton = createNode("button", {
    className: "copy-button",
    text: "본문 복사",
    type: "button",
  });
  copyButton.addEventListener("click", () => copyPrompt(version.body, body));
  header.appendChild(copyButton);
  item.append(header, body);
  return item;
}

function renderDeleteGroupButton(group) {
  const button = createNode("button", {
    className: "delete-button",
    text: "삭제",
    type: "button",
  });
  button.addEventListener("click", async () => {
    const confirmed = window.confirm(`"${group.title}" 프롬프트 그룹을 삭제할까요?`);
    if (!confirmed) {
      return;
    }

    state.groups = state.groups.filter((item) => item.id !== group.id);
    await saveGroups();
    showToast("프롬프트 그룹을 삭제했어요.");
    window.location.hash = "#/";
  });
  return button;
}

function renderEditor(existingGroup) {
  const isEdit = Boolean(existingGroup);
  const group = cloneGroup(existingGroup) || createEmptyGroup();
  document.title = isEdit ? `${group.title} 수정 - 프롬프트 라이브러리` : "새 프롬프트 - 프롬프트 라이브러리";

  const taxonomy = collectTaxonomy();
  const view = createNode("section", {
    className: "editor-view",
    attrs: { "aria-labelledby": "editor-title" },
  });

  const heading = createNode("div", { className: "view-heading" }, [
    createNode("div", {}, [
      createLink(isEdit ? `#/prompt/${encodeURIComponent(group.id)}` : "#/", "돌아가기", "text-link"),
      createNode("p", { className: "eyebrow", text: isEdit ? "Edit" : "New" }),
      createNode("h2", { id: "editor-title", text: isEdit ? "프롬프트 그룹 수정" : "새 프롬프트 그룹" }),
      createNode("p", {
        className: "view-copy",
        text: "그룹 정보와 여러 버전을 함께 관리하세요. 순차 타입은 단계별 입력 흐름으로 저장됩니다.",
      }),
    ]),
  ]);

  const form = createNode("form", { className: "editor-form" });
  form.noValidate = true;

  const categoryListId = "categorySuggestions";
  const datalist = createNode("datalist", { id: categoryListId });
  taxonomy.categories.forEach((category) => {
    datalist.appendChild(createNode("option", { value: category }));
  });

  form.append(
    renderTextField("groupTitle", "제목", group.title, "예: 코드 리뷰 체크리스트", true),
    renderTextAreaField("groupDescription", "설명", group.description, "언제 쓰는 프롬프트인지 짧게 적기", 4),
    renderTextField("groupCategory", "카테고리", group.category, "예: 글쓰기, 개발, 리서치", false, {
      list: categoryListId,
    }),
    datalist,
    renderTextField("groupTags", "태그", group.tags.join(", "), "쉼표로 구분: 리뷰, 자동화, 초안"),
    renderUseCaseEditor(group.useCases),
    renderVersionsEditor(group.versions)
  );

  const actions = createNode("div", { className: "form-actions sticky-actions" }, [
    createNode("button", {
      className: "primary-button",
      text: isEdit ? "수정 저장" : "그룹 저장",
      type: "submit",
    }),
    createLink(isEdit ? `#/prompt/${encodeURIComponent(group.id)}` : "#/", "취소", "ghost-button"),
  ]);
  form.appendChild(actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const collected = collectEditorData(form, group, existingGroup);
    if (!collected) {
      return;
    }

    if (isEdit) {
      state.groups = state.groups.map((item) => (item.id === collected.id ? collected : item));
      showToast("프롬프트 그룹을 수정했어요.");
    } else {
      state.groups = [collected, ...state.groups];
      showToast("프롬프트 그룹을 추가했어요.");
    }

    await saveGroups();
    window.location.hash = `#/prompt/${encodeURIComponent(collected.id)}`;
  });

  view.append(heading, form);
  app.appendChild(view);
}

function renderTextField(id, label, value, placeholder, required = false, attrs = {}) {
  const input = createNode("input", {
    id,
    value,
    placeholder,
    required,
    attrs,
  });
  return createNode("label", { className: "field-label", text: label }, [input]);
}

function renderTextAreaField(id, label, value, placeholder, rows = 6, required = false) {
  const input = createNode("textarea", {
    id,
    value,
    placeholder,
    rows,
    required,
  });
  return createNode("label", { className: "field-label", text: label }, [input]);
}

function renderUseCaseEditor(useCases) {
  const fieldset = createNode("fieldset", { className: "fieldset-block" }, [
    createNode("legend", { text: "사용처" }),
  ]);
  const presetList = createNode("div", { className: "checkbox-grid" });

  USE_CASE_PRESETS.forEach((preset) => {
    const checkbox = createNode("input", {
      type: "checkbox",
      value: preset,
      checked: useCases.includes(preset),
      attrs: { name: "useCasePreset" },
    });
    presetList.appendChild(
      createNode("label", { className: "checkbox-pill" }, [checkbox, document.createTextNode(preset)])
    );
  });

  const customUseCases = useCases
    .filter((useCase) => !USE_CASE_PRESETS.includes(useCase))
    .join(", ");

  fieldset.append(
    presetList,
    renderTextField("customUseCases", "직접 추가", customUseCases, "쉼표로 구분: Perplexity, 사내 도구")
  );
  return fieldset;
}

function renderVersionsEditor(versions) {
  const wrapper = createNode("section", {
    className: "versions-editor",
    attrs: { "aria-labelledby": "versions-title" },
  });
  const heading = createNode("div", { className: "versions-editor-heading" }, [
    createNode("div", {}, [
      createNode("p", { className: "eyebrow", text: "Versions" }),
      createNode("h3", { id: "versions-title", text: "버전" }),
    ]),
    createNode("button", {
      className: "ghost-button",
      text: "버전 추가",
      type: "button",
    }),
  ]);

  const addButton = heading.querySelector("button");
  const versionList = createNode("div", { className: "version-editor-list" });
  versions.forEach((version) => versionList.appendChild(renderVersionEditor(version)));

  addButton.addEventListener("click", () => {
    versionList.appendChild(renderVersionEditor(createEmptyVersion()));
    refreshVersionEditors(versionList);
  });

  wrapper.append(heading, versionList);
  refreshVersionEditors(versionList);
  return wrapper;
}

function renderVersionEditor(version) {
  const normalizedVersion = normalizeVersion(version);
  const panel = createNode("fieldset", {
    className: "version-editor",
    dataset: { versionId: normalizedVersion.id },
  });
  const versionDomId = normalizedVersion.id.replace(/[^a-zA-Z0-9_-]/g, "");

  const legend = createNode("legend", { text: "버전" });
  const versionTitle = renderTextField(
    `versionTitle-${versionDomId}`,
    "버전 제목",
    normalizedVersion.title,
    "예: 기본형, 리서치용, 짧은 답변용"
  );
  versionTitle.querySelector("input").classList.add("version-title-input");

  const typeLabel = createNode("label", { className: "field-label", text: "타입" });
  const typeSelect = createNode("select", { className: "version-type-select" });
  Object.entries(VERSION_TYPES).forEach(([value, label]) => {
    typeSelect.appendChild(createNode("option", { value, text: label }));
  });
  typeSelect.value = normalizedVersion.type;
  typeLabel.appendChild(typeSelect);
  const typeBadge = createNode("span", {
    className: "version-type-badge",
    text: VERSION_TYPES[normalizedVersion.type],
  });

  const purposeField = renderTextAreaField(
    `versionPurpose-${versionDomId}`,
    "목적",
    normalizedVersion.purpose,
    "이 버전이 필요한 상황이나 다른 버전과의 차이",
    3
  );
  purposeField.querySelector("textarea").classList.add("version-purpose-input");

  const bodyField = renderTextAreaField(
    `versionBody-${versionDomId}`,
    "프롬프트 본문",
    normalizedVersion.body,
    "프롬프트를 붙여넣으세요.",
    10,
    true
  );
  bodyField.classList.add("version-body-field");
  bodyField.querySelector("textarea").classList.add("version-body-input");

  const stepsBlock = createNode("div", { className: "steps-editor" }, [
    createNode("div", { className: "steps-heading" }, [
      createNode("strong", { text: "순차 단계" }),
      createNode("button", {
        className: "ghost-button compact-button add-step-button",
        text: "단계 추가",
        type: "button",
      }),
    ]),
    createNode("div", { className: "step-editor-list" }),
  ]);

  const stepList = stepsBlock.querySelector(".step-editor-list");
  getOrderedSteps(normalizedVersion).forEach((step) => {
    stepList.appendChild(renderStepEditor(step));
  });
  stepsBlock.querySelector(".add-step-button").addEventListener("click", () => {
    stepList.appendChild(renderStepEditor(createEmptyStep(stepList.children.length + 1)));
    refreshStepEditors(stepList);
  });

  const deleteButton = createNode("button", {
    className: "delete-button compact-button delete-version-button",
    text: "버전 삭제",
    type: "button",
  });
  deleteButton.addEventListener("click", () => {
    const versionList = panel.closest(".version-editor-list");
    if (versionList.children.length <= 1) {
      showToast("마지막 버전은 삭제할 수 없어요.");
      return;
    }

    panel.remove();
    refreshVersionEditors(versionList);
  });

  typeSelect.addEventListener("change", () => {
    if (typeSelect.value === "sequence" && !stepList.children.length) {
      const bodyValue = bodyField.querySelector("textarea").value.trim();
      stepList.appendChild(createEmptyStepEditorFromBody(bodyValue));
    }
    if (typeSelect.value !== "sequence" && !bodyField.querySelector("textarea").value.trim()) {
      const firstStepBody = stepList.querySelector(".step-body-input")?.value.trim();
      bodyField.querySelector("textarea").value = firstStepBody || "";
    }
    typeBadge.textContent = VERSION_TYPES[typeSelect.value];
    toggleVersionType(panel);
  });

  panel.append(legend, typeBadge, versionTitle, typeLabel, purposeField, bodyField, stepsBlock, deleteButton);
  toggleVersionType(panel);
  refreshStepEditors(stepList);
  return panel;
}

function renderStepEditor(step) {
  const panel = createNode("div", {
    className: "step-editor",
    dataset: { stepId: step.id },
  });
  const stepDomId = step.id.replace(/[^a-zA-Z0-9_-]/g, "");

  const titleField = renderTextField(
    `stepTitle-${stepDomId}`,
    "단계 제목",
    step.title,
    "예: 1단계 - 자료 요약"
  );
  titleField.querySelector("input").classList.add("step-title-input");

  const bodyField = renderTextAreaField(
    `stepBody-${stepDomId}`,
    "단계 본문",
    step.body,
    "이 단계에서 입력할 프롬프트",
    7,
    true
  );
  bodyField.querySelector("textarea").classList.add("step-body-input");

  const moveUpButton = createNode("button", {
    className: "ghost-button compact-button move-step-up",
    text: "위로",
    type: "button",
  });
  moveUpButton.addEventListener("click", () => {
    const list = panel.parentElement;
    const previous = panel.previousElementSibling;
    if (previous) {
      list.insertBefore(panel, previous);
      refreshStepEditors(list);
    }
  });

  const moveDownButton = createNode("button", {
    className: "ghost-button compact-button move-step-down",
    text: "아래로",
    type: "button",
  });
  moveDownButton.addEventListener("click", () => {
    const list = panel.parentElement;
    const next = panel.nextElementSibling;
    if (next) {
      list.insertBefore(next, panel);
      refreshStepEditors(list);
    }
  });

  const deleteButton = createNode("button", {
    className: "delete-button compact-button delete-step-button",
    text: "단계 삭제",
    type: "button",
  });
  deleteButton.addEventListener("click", () => {
    const list = panel.parentElement;
    if (list.children.length <= 1) {
      showToast("순차 프롬프트의 마지막 단계는 삭제할 수 없어요.");
      return;
    }

    panel.remove();
    refreshStepEditors(list);
  });

  panel.append(
    createNode("div", { className: "step-editor-heading" }, [
      createNode("strong", { className: "step-index", text: "단계" }),
      createNode("div", { className: "step-controls" }, [moveUpButton, moveDownButton, deleteButton]),
    ]),
    titleField,
    bodyField
  );
  return panel;
}

function createEmptyStepEditorFromBody(body) {
  return renderStepEditor({
    ...createEmptyStep(1),
    body,
  });
}

function toggleVersionType(panel) {
  const isSequence = panel.querySelector(".version-type-select").value === "sequence";
  panel.querySelector(".version-body-field").hidden = isSequence;
  panel.querySelector(".steps-editor").hidden = !isSequence;
}

function refreshVersionEditors(versionList) {
  [...versionList.querySelectorAll(".version-editor")].forEach((panel, index) => {
    panel.querySelector("legend").textContent = `버전 ${index + 1}`;
    panel.querySelector(".delete-version-button").disabled = versionList.children.length <= 1;
  });
}

function refreshStepEditors(stepList) {
  [...stepList.querySelectorAll(".step-editor")].forEach((panel, index, panels) => {
    panel.querySelector(".step-index").textContent = `${index + 1}단계`;
    panel.querySelector(".move-step-up").disabled = index === 0;
    panel.querySelector(".move-step-down").disabled = index === panels.length - 1;
    panel.querySelector(".delete-step-button").disabled = panels.length <= 1;
  });
}

function collectEditorData(form, draftGroup, existingGroup) {
  const titleInput = form.querySelector("#groupTitle");
  const title = titleInput.value.trim();
  if (!title) {
    showToast("그룹 제목을 입력해 주세요.");
    titleInput.focus();
    return null;
  }

  const now = new Date().toISOString();
  const versionEls = [...form.querySelectorAll(".version-editor")];
  const versions = [];

  for (let index = 0; index < versionEls.length; index += 1) {
    const versionEl = versionEls[index];
    const versionId = versionEl.dataset.versionId || createId("version");
    const previousVersion = existingGroup?.versions.find((version) => version.id === versionId);
    const type = versionEl.querySelector(".version-type-select").value;
    const versionTitle =
      versionEl.querySelector(".version-title-input").value.trim() ||
      `${VERSION_TYPES[type]} ${index + 1}`;
    const purpose = versionEl.querySelector(".version-purpose-input").value.trim();

    if (type === "sequence") {
      const stepEls = [...versionEl.querySelectorAll(".step-editor")];
      const steps = [];

      for (let stepIndex = 0; stepIndex < stepEls.length; stepIndex += 1) {
        const stepEl = stepEls[stepIndex];
        const bodyInput = stepEl.querySelector(".step-body-input");
        const body = bodyInput.value.trim();
        if (!body) {
          showToast("순차 프롬프트 단계 본문을 입력해 주세요.");
          bodyInput.focus();
          return null;
        }

        steps.push({
          id: stepEl.dataset.stepId || createId("step"),
          title: stepEl.querySelector(".step-title-input").value.trim() || `${stepIndex + 1}단계`,
          body,
          order: stepIndex + 1,
        });
      }

      versions.push({
        id: versionId,
        title: versionTitle,
        type,
        purpose,
        body: "",
        steps,
        createdAt: previousVersion?.createdAt || now,
        updatedAt: now,
      });
    } else {
      const bodyInput = versionEl.querySelector(".version-body-input");
      const body = bodyInput.value.trim();
      if (!body) {
        showToast("프롬프트 본문을 입력해 주세요.");
        bodyInput.focus();
        return null;
      }

      versions.push({
        id: versionId,
        title: versionTitle,
        type,
        purpose,
        body,
        steps: [],
        createdAt: previousVersion?.createdAt || now,
        updatedAt: now,
      });
    }
  }

  return {
    id: draftGroup.id || createId("group"),
    title,
    description: form.querySelector("#groupDescription").value.trim(),
    category: form.querySelector("#groupCategory").value.trim(),
    tags: parseList(form.querySelector("#groupTags").value),
    useCases: collectUseCases(form),
    versions,
    createdAt: existingGroup?.createdAt || now,
    updatedAt: now,
  };
}

function collectUseCases(form) {
  const presets = [...form.querySelectorAll("input[name='useCasePreset']:checked")].map(
    (input) => input.value
  );
  const custom = parseList(form.querySelector("#customUseCases").value);
  return uniqueValues([...presets, ...custom]);
}

function renderMissing() {
  document.title = "프롬프트를 찾을 수 없음";
  app.appendChild(
    createNode("section", { className: "missing-view" }, [
      createNode("p", { className: "eyebrow", text: "Not found" }),
      createNode("h2", { text: "프롬프트를 찾을 수 없어요." }),
      createNode("p", {
        className: "view-copy",
        text: "삭제되었거나 잘못된 링크일 수 있습니다.",
      }),
      createLink("#/", "라이브러리로 돌아가기", "primary-button"),
    ])
  );
}

function filterGroups() {
  const query = normalizeSearch(state.filters.query);
  return [...state.groups]
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .filter((group) => {
      if (state.filters.category !== "all" && group.category !== state.filters.category) {
        return false;
      }
      if (state.filters.tag !== "all" && !group.tags.includes(state.filters.tag)) {
        return false;
      }
      if (state.filters.useCase !== "all" && !group.useCases.includes(state.filters.useCase)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return buildSearchText(group).includes(query);
    });
}

function buildSearchText(group) {
  const versionText = group.versions
    .flatMap((version) => [
      version.title,
      version.type,
      version.purpose,
      version.body,
      ...getOrderedSteps(version).flatMap((step) => [step.title, step.body]),
    ])
    .join(" ");

  return normalizeSearch(
    [
      group.title,
      group.description,
      group.category,
      group.tags.join(" "),
      group.useCases.join(" "),
      versionText,
    ].join(" ")
  );
}

function collectTaxonomy() {
  return {
    categories: uniqueValues(state.groups.map((group) => group.category).filter(Boolean)).sort(),
    tags: uniqueValues(state.groups.flatMap((group) => group.tags)).sort(),
    useCases: uniqueValues([
      ...USE_CASE_PRESETS,
      ...state.groups.flatMap((group) => group.useCases),
    ]).sort(),
  };
}

async function initializeBackend() {
  if (!supabaseClient) {
    return;
  }

  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      throw error;
    }

    state.session = data.session;
    state.authReady = true;

    supabaseClient.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      state.authReady = true;
      state.syncError = "";

      if (session) {
        await loadRemoteGroups({ migrateLocalWhenEmpty: true });
      } else {
        state.backendStatus = "로그아웃됨. 로컬 백업을 표시합니다.";
        state.groups = loadGroups();
        renderApp();
      }
    });

    if (state.session) {
      await loadRemoteGroups({ migrateLocalWhenEmpty: true });
      return;
    }

    state.backendStatus = "로그인이 필요합니다.";
    renderApp();
  } catch (error) {
    console.error("Supabase 초기화에 실패했습니다.", error);
    state.authReady = true;
    state.syncError = "Supabase 연결을 확인하지 못했습니다. 설정값과 Auth URL을 확인해 주세요.";
    renderApp();
  }
}

async function sendLoginLink(email, button) {
  if (!email) {
    showToast("이메일을 입력해 주세요.");
    return;
  }

  button.disabled = true;
  button.textContent = "전송 중";

  try {
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.href.split("#")[0],
      },
    });

    if (error) {
      throw error;
    }

    state.backendStatus = "로그인 링크를 보냈어요. 이메일을 확인해 주세요.";
    state.syncError = "";
    showToast("로그인 링크를 보냈어요.");
    renderApp();
  } catch (error) {
    console.error("로그인 링크 전송에 실패했습니다.", error);
    state.syncError = "로그인 링크 전송에 실패했습니다. Supabase Auth 설정을 확인해 주세요.";
    showToast("로그인 링크를 보내지 못했어요.");
    renderApp();
  }
}

async function signOut() {
  if (!supabaseClient) {
    return;
  }

  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    console.error("로그아웃에 실패했습니다.", error);
    showToast("로그아웃하지 못했어요.");
    return;
  }

  state.session = null;
  state.backendStatus = "로그아웃됨. 로컬 백업을 표시합니다.";
  state.groups = loadGroups();
  renderApp();
}

async function loadRemoteGroups({ migrateLocalWhenEmpty }) {
  if (!isRemoteReady()) {
    return;
  }

  try {
    state.backendStatus = "Supabase에서 불러오는 중";
    state.syncError = "";

    const localGroups = loadGroups();
    const { data, error } = await supabaseClient
      .from("prompt_groups")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      throw error;
    }

    const remoteGroups = (data || []).map(rowToGroup).filter(Boolean);
    if (migrateLocalWhenEmpty && remoteGroups.length === 0 && localGroups.length > 0) {
      state.groups = localGroups;
      await saveRemoteGroups();
      state.backendStatus = "로컬 데이터를 Supabase로 옮겼어요.";
    } else {
      state.groups = remoteGroups;
      state.backendStatus = "Supabase와 동기화됨";
    }

    writeStorageArray(STORAGE_KEY_V2, state.groups);
    renderApp();
  } catch (error) {
    console.error("Supabase 데이터를 불러오지 못했습니다.", error);
    state.syncError = "Supabase 데이터를 불러오지 못해 로컬 백업을 표시합니다.";
    showToast("Supabase 동기화에 실패했어요.");
    renderApp();
  }
}

function loadGroups() {
  const v2Groups = readStorageArray(STORAGE_KEY_V2);
  if (v2Groups) {
    return v2Groups.map(normalizeGroup).filter(Boolean);
  }

  const v1Prompts = readStorageArray(STORAGE_KEY_V1);
  if (v1Prompts) {
    const migratedGroups = v1Prompts.map(migrateV1Prompt).filter(Boolean);
    writeStorageArray(STORAGE_KEY_V2, migratedGroups);
    return migratedGroups;
  }

  return [];
}

function readStorageArray(key) {
  try {
    const storedValue = localStorage.getItem(key);
    if (!storedValue) {
      return null;
    }
    const parsed = JSON.parse(storedValue);
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    console.warn(`${key} 저장소를 읽을 수 없습니다.`, error);
    return null;
  }
}

function writeStorageArray(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`${key} 저장소에 쓸 수 없습니다.`, error);
    showToast("브라우저 저장 공간에 저장하지 못했어요.");
  }
}

async function saveGroups() {
  writeStorageArray(STORAGE_KEY_V2, state.groups);

  if (!isRemoteReady()) {
    return;
  }

  try {
    await saveRemoteGroups();
    state.backendStatus = "Supabase와 동기화됨";
    state.syncError = "";
  } catch (error) {
    console.error("Supabase 저장에 실패했습니다.", error);
    state.syncError = "로컬에는 저장했지만 Supabase 저장은 실패했습니다.";
    showToast("Supabase 저장에 실패했어요.");
  }
}

async function saveRemoteGroups() {
  const rows = state.groups.map(groupToRow);
  const currentIds = rows.map((row) => row.id);
  const { data: existingRows, error: selectError } = await supabaseClient
    .from("prompt_groups")
    .select("id");

  if (selectError) {
    throw selectError;
  }

  if (rows.length) {
    const { error: upsertError } = await supabaseClient
      .from("prompt_groups")
      .upsert(rows, { onConflict: "id" });

    if (upsertError) {
      throw upsertError;
    }
  }

  const idsToDelete = (existingRows || [])
    .map((row) => row.id)
    .filter((id) => !currentIds.includes(id));

  if (idsToDelete.length) {
    const { error: deleteError } = await supabaseClient
      .from("prompt_groups")
      .delete()
      .in("id", idsToDelete);

    if (deleteError) {
      throw deleteError;
    }
  }
}

function rowToGroup(row) {
  if (!row) {
    return null;
  }

  return normalizeGroup({
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: row.tags,
    useCases: row.use_cases,
    versions: row.versions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function groupToRow(group) {
  return {
    id: group.id,
    owner_id: state.session.user.id,
    title: group.title,
    description: group.description || "",
    category: group.category || "",
    tags: group.tags || [],
    use_cases: group.useCases || [],
    versions: group.versions || [],
    created_at: group.createdAt,
    updated_at: group.updatedAt,
  };
}

function isRemoteReady() {
  return Boolean(supabaseClient && state.session?.user?.id);
}

function createSupabaseClient() {
  const config = window.PROMPT_LIBRARY_SUPABASE || {};
  const url = String(config.url || "").trim();
  const key = String(config.publishableKey || config.anonKey || "").trim();

  if (!url || !key || url.includes("YOUR_") || key.includes("YOUR_")) {
    return null;
  }

  if (!window.supabase?.createClient) {
    console.warn("Supabase JavaScript SDK를 찾을 수 없습니다.");
    return null;
  }

  return window.supabase.createClient(url, key);
}

function migrateV1Prompt(prompt) {
  if (!prompt || !prompt.title || !prompt.body) {
    return null;
  }

  const now = new Date().toISOString();
  const createdAt = prompt.createdAt || now;
  const updatedAt = prompt.updatedAt || createdAt;

  return normalizeGroup({
    id: prompt.id || createId("group"),
    title: prompt.title,
    description: prompt.description || "",
    category: "",
    tags: [],
    useCases: [],
    versions: [
      {
        id: createId("version"),
        title: "기본 버전",
        type: "normal",
        purpose: prompt.description || "",
        body: prompt.body,
        steps: [],
        createdAt,
        updatedAt,
      },
    ],
    createdAt,
    updatedAt,
  });
}

function normalizeGroup(group) {
  if (!group || !group.title) {
    return null;
  }

  const now = new Date().toISOString();
  const versions = Array.isArray(group.versions)
    ? group.versions.map(normalizeVersion).filter(Boolean)
    : [];

  return {
    id: group.id || createId("group"),
    title: String(group.title || "").trim(),
    description: String(group.description || "").trim(),
    category: String(group.category || "").trim(),
    tags: Array.isArray(group.tags) ? uniqueValues(group.tags.map(String).map((tag) => tag.trim()).filter(Boolean)) : [],
    useCases: Array.isArray(group.useCases)
      ? uniqueValues(group.useCases.map(String).map((useCase) => useCase.trim()).filter(Boolean))
      : [],
    versions: versions.length ? versions : [createEmptyVersion()],
    createdAt: group.createdAt || now,
    updatedAt: group.updatedAt || group.createdAt || now,
  };
}

function normalizeVersion(version) {
  const now = new Date().toISOString();
  const type = Object.keys(VERSION_TYPES).includes(version?.type) ? version.type : "normal";
  const steps = Array.isArray(version?.steps)
    ? version.steps.map(normalizeStep).filter(Boolean)
    : [];

  return {
    id: version?.id || createId("version"),
    title: String(version?.title || "").trim(),
    type,
    purpose: String(version?.purpose || "").trim(),
    body: String(version?.body || "").trim(),
    steps: steps.length ? steps : [createEmptyStep(1)],
    createdAt: version?.createdAt || now,
    updatedAt: version?.updatedAt || version?.createdAt || now,
  };
}

function normalizeStep(step, index = 0) {
  if (!step) {
    return null;
  }

  return {
    id: step.id || createId("step"),
    title: String(step.title || "").trim(),
    body: String(step.body || "").trim(),
    order: Number.isFinite(Number(step.order)) ? Number(step.order) : index + 1,
  };
}

function createEmptyGroup() {
  const now = new Date().toISOString();
  return {
    id: createId("group"),
    title: "",
    description: "",
    category: "",
    tags: [],
    useCases: [],
    versions: [createEmptyVersion()],
    createdAt: now,
    updatedAt: now,
  };
}

function createEmptyVersion() {
  const now = new Date().toISOString();
  return {
    id: createId("version"),
    title: "",
    type: "normal",
    purpose: "",
    body: "",
    steps: [createEmptyStep(1)],
    createdAt: now,
    updatedAt: now,
  };
}

function createEmptyStep(order) {
  return {
    id: createId("step"),
    title: `${order}단계`,
    body: "",
    order,
  };
}

function cloneGroup(group) {
  return group ? JSON.parse(JSON.stringify(group)) : null;
}

function findGroup(id) {
  return state.groups.find((group) => group.id === id);
}

function getOrderedSteps(version) {
  return [...(version.steps || [])].sort((a, b) => a.order - b.order);
}

function buildSequenceText(version) {
  return getOrderedSteps(version)
    .map((step, index) => `${index + 1}. ${step.title || `${index + 1}단계`}\n${step.body}`)
    .join("\n\n");
}

async function copyPrompt(text, fallbackElement) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else if (fallbackElement) {
      fallbackElement.focus();
      fallbackElement.select();
      const successful = document.execCommand("copy");
      if (!successful) {
        throw new Error("execCommand copy failed");
      }
    } else {
      throw new Error("clipboard unavailable");
    }

    showToast("프롬프트를 복사했어요.");
  } catch (error) {
    console.warn("클립보드 복사에 실패했습니다.", error);
    if (fallbackElement) {
      fallbackElement.focus();
      fallbackElement.select();
    }
    showToast("복사에 실패했어요. 본문을 선택해 두었어요.");
  }
}

function createId(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseList(value) {
  return uniqueValues(
    String(value || "")
      .split(",")
      .map((item) => item.trim().replace(/^#/, ""))
      .filter(Boolean)
  );
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function normalizeSearch(value) {
  return String(value || "").toLocaleLowerCase("ko-KR").trim();
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function createLink(href, text, className) {
  return createNode("a", { href, text, className });
}

function createNode(tag, options = {}, children = []) {
  const node = document.createElement(tag);

  if (options.id) {
    node.id = options.id;
  }
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  if (options.value !== undefined) {
    node.value = options.value;
  }
  if (options.type) {
    node.type = options.type;
  }
  if (options.placeholder) {
    node.placeholder = options.placeholder;
  }
  if (options.required) {
    node.required = true;
  }
  if (options.checked) {
    node.checked = true;
  }
  if (options.disabled) {
    node.disabled = true;
  }
  if (options.readOnly) {
    node.readOnly = true;
  }
  if (options.rows) {
    node.rows = options.rows;
  }
  if (options.href) {
    node.href = options.href;
  }
  if (options.dataset) {
    Object.entries(options.dataset).forEach(([key, value]) => {
      node.dataset[key] = value;
    });
  }
  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => {
      node.setAttribute(key, value);
    });
  }

  const childList = Array.isArray(children) ? children : [children];
  childList.filter(Boolean).forEach((child) => {
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  });

  return node;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2400);
}
