import { createRouter, createWebHistory } from 'vue-router'
import type { RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { autoSetup, getCurrentUser, userInfoFromApi, getAuthConfig } from '@/api/auth'

/** Lite /桌面 WebView 硬刷新时可能只打开 `/`，用 session 记住上次页面以便恢复 */
const LITE_LAST_PATH_KEY = 'weknora_lite_last_path'
const AUTO_SETUP_FAILED_KEY = 'weknora_auto_setup_failed'
/**
 * 服务端初始化状态缓存。
 *
 * P0-5 修复：原 autoSetup 兜底登录仅靠 localStorage `weknora_auto_setup_failed`
 * 标记判定"已尝试过"，没有服务端版本探测。服务端重置 / 重新部署 / 切换后端
 * 后，前端 localStorage 仍认为未失败，会反复尝试 autoSetup 拖慢首屏。
 *
 * 改用 sessionStorage 缓存本次会话内的服务端探测结果：
 *   - 'ready'     服务端已初始化，可以尝试 autoSetup
 *   - 'uninit'    服务端尚未初始化（getAuthConfig 失败），跳过 autoSetup
 * 仅在 sessionStorage 中保存（关闭标签即失效），避免跨会话用过期数据。
 */
const SERVER_INIT_STATUS_KEY = 'weknora_server_init_status'

function shouldTryAutoSetup() {
  return localStorage.getItem(AUTO_SETUP_FAILED_KEY) !== 'true'
}

function markAutoSetupFailed() {
  localStorage.setItem(AUTO_SETUP_FAILED_KEY, 'true')
}

/**
 * 探测服务端初始化状态。
 *
 * 调用 /auth/config 这个公开接口（无需鉴权）作为轻量级心跳：
 *   - 返回 success: true → 服务端可用且已初始化
 *   - 返回 success: false 或抛错 → 服务端未就绪，跳过 autoSetup
 *
 * 结果缓存在 sessionStorage，避免每次路由跳转都打一次。
 */
async function probeServerInitStatus(): Promise<boolean> {
  // 命中缓存直接返回
  const cached = sessionStorage.getItem(SERVER_INIT_STATUS_KEY)
  if (cached === 'ready') return true
  if (cached === 'uninit') return false

  try {
    const resp = await getAuthConfig()
    const ready = !!resp?.success
    sessionStorage.setItem(SERVER_INIT_STATUS_KEY, ready ? 'ready' : 'uninit')
    return ready
  } catch {
    sessionStorage.setItem(SERVER_INIT_STATUS_KEY, 'uninit')
    return false
  }
}

function isLiteEdition(authStore: ReturnType<typeof useAuthStore>) {
  return authStore.isLiteMode || localStorage.getItem('weknora_lite_mode') === 'true'
}

function isLiteSpaDefaultEntry(to: RouteLocationNormalized) {
  return (
    to.path === '/' ||
    to.path === '/platform' ||
    to.path === '/platform/knowledge-bases' ||
    to.name === 'knowledgeBaseList'
  )
}

function isSafeLiteRestoreTarget(path: string) {
  return path.startsWith('/platform/') && !path.startsWith('/platform/organizations')
}

function hasPendingOIDCCallback() {
  if (typeof window === 'undefined') return false
  const hash = window.location.hash || ''
  return hash.includes('oidc_result=') || hash.includes('oidc_error=')
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      redirect: "/platform/knowledge-bases",
    },
    {
      path: "/login",
      name: "login",
      component: () => import("../views/auth/Login.vue"),
      meta: { requiresAuth: false, requiresInit: false }
    },
    // Embed chat is a separate entry (embed.html + embed-main.ts), not this SPA.
    {
      path: "/register",
      name: "registerByInvite",
      // Share-link landing page reuses the Login form: the same Vue
      // component renders both modes and detects ?token=xxx on mount
      // to switch into invite-register flow. Avoids a parallel page
      // that would duplicate the OIDC / language-switch / styling
      // surface for one extra field.
      component: () => import("../views/auth/Login.vue"),
      meta: { requiresAuth: false, requiresInit: false }
    },
    {
      path: "/join",
      name: "joinOrganization",
      // 重定向到组织列表页，并将 code 参数转换为 invite_code
      redirect: (to) => {
        const code = to.query.code as string
        return {
          path: '/platform/organizations',
          query: code ? { invite_code: code } : {}
        }
      },
      meta: { requiresInit: true, requiresAuth: true }
    },
    {
      path: "/knowledgeBase",
      name: "home",
      component: () => import("../views/knowledge/KnowledgeBase.vue"),
      meta: { requiresInit: true, requiresAuth: true }
    },
    {
      path: "/platform",
      name: "Platform",
      redirect: "/platform/knowledge-bases",
      component: () => import("../views/platform/index.vue"),
      meta: { requiresInit: true, requiresAuth: true },
      children: [
        {
          path: "tenant",
          redirect: "/platform/settings"
        },
        {
          path: "settings",
          name: "settings",
          component: () => import("../views/settings/Settings.vue"),
          meta: { requiresInit: true, requiresAuth: true }
        },
        {
          path: "knowledge-bases",
          name: "knowledgeBaseList",
          component: () => import("../views/knowledge/KnowledgeBaseList.vue"),
          meta: { requiresInit: true, requiresAuth: true }
        },
        {
          path: "knowledge-bases/:kbId",
          name: "knowledgeBaseDetail",
          component: () => import("../views/knowledge/KnowledgeBase.vue"),
          meta: { requiresInit: true, requiresAuth: true }
        },
        {
          path: "knowledge-search",
          // 旧路径保留为重定向，打开全局命令面板（⌘K），带上可选的 q 参数
          redirect: (to) => {
            const q = to.query.q
            return {
              path: '/platform/knowledge-bases',
              query: typeof q === 'string' ? { cmdk: q } : { cmdk: '' },
            }
          },
        },
        {
          path: "agents",
          name: "agentList",
          component: () => import("../views/agent/AgentList.vue"),
          meta: { requiresInit: true, requiresAuth: true }
        },
        {
          path: "integrations",
          name: "integrations",
          component: () => import("../views/platform/RoutePlaceholder.vue"),
          meta: { requiresInit: true, requiresAuth: true }
        },
        {
          path: "chat/:chatid",
          name: "chat",
          component: () => import("../views/chat/index.vue"),
          meta: { requiresInit: true, requiresAuth: true }
        },
        {
          path: "notebook/:sessionId?",
          name: "notebook",
          component: () => import("../views/notebook/NotebookView.vue"),
          meta: { requiresInit: true, requiresAuth: true }
        },
        // creatChat 已统一到 notebook，保留旧路径重定向避免外链/书签失效
        {
          path: "creatChat",
          redirect: { name: "notebook" }
        },
        {
          path: "knowledge-bases/:kbId/creatChat",
          redirect: { name: "notebook" }
        },
        {
          path: "organizations",
          name: "organizationList",
          component: () => import("../views/organization/OrganizationList.vue"),
          meta: { requiresInit: true, requiresAuth: true }
        },
        // Compatibility redirects for legacy /platform/system/* URLs.
        // The whole system administration surface — global settings
        // and the system-admin roster — now lives as a single section
        // inside the standard Settings modal. We keep the routes
        // around so old bookmarks / external links don't 404.
        {
          path: "system",
          redirect: { path: "/platform/settings", query: { section: "system-global" } },
          meta: { requiresInit: true, requiresAuth: true, requiresSystemAdmin: true },
        },
        {
          path: "system/settings",
          name: "systemSettings",
          redirect: { path: "/platform/settings", query: { section: "system-global" } },
          meta: { requiresInit: true, requiresAuth: true, requiresSystemAdmin: true },
        },
        {
          path: "system/admins",
          name: "systemAdmins",
          redirect: { path: "/platform/settings", query: { section: "system-global" } },
          meta: { requiresInit: true, requiresAuth: true, requiresSystemAdmin: true },
        },
      ],
    },
    // Dev-only markdown rendering test page
    ...(import.meta.env.DEV ? [{
      path: '/platform/dev/markdown',
      name: 'markdownTest',
      component: () => import('../views/dev/MarkdownTestPage.vue'),
      meta: { requiresAuth: false, requiresInit: false }
    }] : []),
    // P0-4 修复：404 兜底路由。原路由表缺少通配匹配，未命中任何路由时
    // vue-router 抛警告且页面白屏，体验灾难。这里加一个 catch-all 渲染 NotFound，
    // 并在 meta 标记 requiresAuth: false 避免未登录用户被二次重定向到 /login
    // 又再次进入 NotFound 的死循环。
    {
      path: '/:pathMatch(.*)*',
      name: 'notFound',
      component: () => import('../views/NotFound.vue'),
      meta: { requiresAuth: false, requiresInit: false },
    },
  ],
});

// 持久化 auto-setup / login 返回的认证信息到 store
function persistLoginResponse(authStore: ReturnType<typeof useAuthStore>, response: any) {
  if (response.user && response.tenant && response.token) {
    authStore.setUser(userInfoFromApi(response.user, response.tenant.id))
    authStore.setToken(response.token)
    if (response.refresh_token) {
      authStore.setRefreshToken(response.refresh_token)
    }
    authStore.setTenant({
      id: String(response.tenant.id) || '',
      name: response.tenant.name || '',
      api_key: response.tenant.api_key || '',
      owner_id: response.user.id || '',
      created_at: response.tenant.created_at || new Date().toISOString(),
      updated_at: response.tenant.updated_at || new Date().toISOString()
    })
  }
}

async function hydrateSessionFromToken(authStore: ReturnType<typeof useAuthStore>) {
  const token = localStorage.getItem('weknora_token')
  if (!token) return false

  if (!authStore.token) {
    authStore.setToken(token)
  }

  const storedRefreshToken = localStorage.getItem('weknora_refresh_token')
  if (storedRefreshToken && !authStore.refreshToken) {
    authStore.setRefreshToken(storedRefreshToken)
  }

  try {
    const response = await getCurrentUser()
    const user = response.data?.user
    if (!response.success || !user) {
      return false
    }

    authStore.setUser(userInfoFromApi(user, response.data?.tenant?.id))

    const tenant = response.data?.tenant
    if (tenant) {
      authStore.setTenant({
        id: String(tenant.id) || '',
        name: tenant.name || '',
        api_key: tenant.api_key || '',
        owner_id: tenant.owner_id || user.id || '',
        description: tenant.description,
        status: tenant.status,
        business: tenant.business,
        storage_quota: tenant.storage_quota,
        storage_used: tenant.storage_used,
        created_at: tenant.created_at || new Date().toISOString(),
        updated_at: tenant.updated_at || new Date().toISOString(),
      })
    }

    // Refresh memberships on every page load — same reason as
    // App.vue's syncOIDCUserContext: without this the auth store
    // would only ever see the snapshot from the original /auth/login
    // call, so role changes (and tenant-switch role lookups) would
    // be silently stale until the user logged out and back in.
    const memberships = response.data?.memberships
    if (Array.isArray(memberships)) {
      authStore.setMemberships(memberships)
    }

    return true
  } catch {
    return false
  }
}

let autoSetupAttempted = false
let liteDeepLinkRestoreDone = false

// 路由守卫：检查认证状态和系统初始化状态
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()

  // OIDC 回跳登录结果依赖 App.vue 在挂载后消费 URL hash。
  // 如果这里先按“未登录”拦截到 /login，会导致回调结果没有机会落盘。
  if (hasPendingOIDCCallback()) {
    next()
    return
  }

  // Lite：硬刷新后若落在默认首页，恢复本次会话中最后访问的 /platform 子路径
  if (!liteDeepLinkRestoreDone) {
    liteDeepLinkRestoreDone = true
    if (isLiteEdition(authStore)) {
      const saved = sessionStorage.getItem(LITE_LAST_PATH_KEY)
      if (saved && isSafeLiteRestoreTarget(saved) && isLiteSpaDefaultEntry(to)) {
        if (saved !== to.fullPath) {
          next(saved)
          return
        }
      }
    }
  }

  // 如果访问的是登录页面或初始化页面，直接放行
  if (to.meta.requiresAuth === false || to.meta.requiresInit === false) {
    // 如果已登录用户访问登录页面，重定向到知识库列表页面
    if (to.path === '/login' && authStore.isLoggedIn) {
      next('/platform/knowledge-bases')
      return
    }
    next()
    return
  }

  // 检查用户认证状态
  if (to.meta.requiresAuth !== false) {
    if (!authStore.isLoggedIn) {
      const restored = await hydrateSessionFromToken(authStore)
      if (restored) {
        next(to.fullPath)
        return
      }

      if (!autoSetupAttempted && shouldTryAutoSetup()) {
        autoSetupAttempted = true
        // P0-5 修复：先探测服务端是否已初始化，避免服务端重置后盲目 autoSetup
        const serverReady = await probeServerInitStatus()
        if (!serverReady) {
          // 服务端未就绪：跳过 autoSetup，直接到登录页让用户看到错误
          next('/login')
          return
        }
        try {
          const response = await autoSetup()
          if (response.success) {
            persistLoginResponse(authStore, response)
            authStore.setLiteMode(true)
            next(to.fullPath)
            return
          } else {
            markAutoSetupFailed()
          }
        } catch {
          markAutoSetupFailed()
        }
      }
      next('/login')
      return
    }
  }

  // SystemAdmin gate — checked AFTER auth so a non-admin who's logged
  // out gets redirected to /login first (consistent with how the rest
  // of the auth flow works), and only an authenticated non-admin sees
  // the bounce. This is UI-only; the server enforces the real check.
  if (to.meta.requiresSystemAdmin === true) {
    if (!authStore.isSystemAdmin) {
      next('/platform/knowledge-bases')
      return
    }
  }

  next()
})

router.afterEach((to) => {
  if (!isLiteEdition(useAuthStore())) return
  if (to.path === '/login') return
  if (!to.path.startsWith('/platform')) return
  sessionStorage.setItem(LITE_LAST_PATH_KEY, to.fullPath)
})

/**
 * 暴露当前 router 实例的 getter，给非组件场景（如 utils/request.ts 的
 * axios 401 拦截器）使用。在 main.ts 调用 setRouterInstance(router) 后才可用。
 *
 * P0-3 修复背景：原 401 拦截器用 window.location.href = '/login' 硬跳转，
 * 整页刷新会丢失所有 Pinia 状态和未保存的输入；改用 router.push 后保留 SPA
 * 状态，并附带 redirect 参数支持登录后回跳到原页面。
 */
let currentRouter: typeof router | null = null

export function setRouterInstance(r: typeof router) {
  currentRouter = r
}

export function getAppRouter(): typeof router | null {
  return currentRouter
}

export default router
