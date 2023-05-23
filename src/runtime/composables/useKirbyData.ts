import { computed, reactive } from 'vue'
import { joinURL } from 'ufo'
import { hash } from 'ohash'
import type { FetchError } from 'ofetch'
import type { NitroFetchOptions } from 'nitropack'
import type { AsyncData, AsyncDataOptions } from 'nuxt/app'
import { toValue } from '@vueuse/core'
import type { MaybeRefOrGetter } from '@vueuse/core'
import { DEFAULT_CLIENT_ERROR, getAuthHeader, getProxyPath, headersToObject } from '../utils'
import { useAsyncData, useRuntimeConfig } from '#imports'

type UseKirbyDataOptions<T> = AsyncDataOptions<T> & Pick<
  NitroFetchOptions<string>,
  | 'onRequest'
  | 'onRequestError'
  | 'onResponse'
  | 'onResponseError'
  | 'headers'
> & {
  /**
   * Language code to fetch data for in multi-language Kirby setups
   */
  language?: string
  /**
   * Skip the Nuxt server proxy and fetch directly from the API.
   * Requires `client` to be enabled in the module options as well.
   * @default false
   */
  client?: boolean
  /**
   * Cache the response between function calls for the same URI
   * @default true
   */
  cache?: boolean
}

export function useKirbyData<T = any>(
  uri: MaybeRefOrGetter<string>,
  opts: UseKirbyDataOptions<T> = {},
) {
  const {
    server,
    lazy,
    default: defaultFn,
    transform,
    pick,
    watch,
    immediate,
    headers,
    language,
    client = false,
    cache = true,
    ...fetchOptions
  } = opts

  const { kql } = useRuntimeConfig().public
  const _uri = computed(() => {
    const value = toValue(uri).replace(/^\//, '')
    return language ? joinURL(language, value) : value
  })

  if (!_uri.value || (language && !_uri.value.replace(new RegExp(`^${language}/`), '')))
    console.warn('[useKirbyData] Empty Kirby URI')

  if (client && !kql.client)
    throw new Error(DEFAULT_CLIENT_ERROR)

  const baseHeaders = headersToObject(headers)

  const asyncDataOptions: AsyncDataOptions<T> = {
    server,
    lazy,
    default: defaultFn,
    transform,
    pick,
    watch: [
      _uri,
      ...(watch || []),
    ],
    immediate,
  }

  const _serverFetchOptions = reactive<NitroFetchOptions<string>>({
    method: 'POST',
    body: {
      uri: _uri,
      cache,
      headers: Object.keys(baseHeaders).length ? baseHeaders : undefined,
    },
  })

  const _clientFetchOptions: NitroFetchOptions<string> = {
    baseURL: kql.url,
    headers: {
      ...baseHeaders,
      ...getAuthHeader(kql),
    },
  }

  let controller: AbortController | undefined
  const key = computed(() => `$kirby${hash([_uri.value, language])}`)

  return useAsyncData<T, FetchError>(
    key.value,
    async (nuxt) => {
      controller?.abort?.()

      // Workaround to persist response client-side
      // https://github.com/nuxt/nuxt/issues/15445
      if ((nuxt!.isHydrating || cache) && key.value in nuxt!.payload.data)
        return nuxt!.payload.data[key.value]

      controller = new AbortController()

      const result = (await globalThis.$fetch<T>(
        client ? _uri.value : getProxyPath(key.value),
        {
          ...fetchOptions,
          signal: controller.signal,
          ...(client ? _clientFetchOptions : _serverFetchOptions),
        },
      )) as T

      if (cache)
        nuxt!.payload.data[key.value] = result

      return result
    },
    asyncDataOptions,
  ) as AsyncData<T, FetchError>
}
