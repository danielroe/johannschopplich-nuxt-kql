import { computed } from 'vue'
import { joinURL } from 'ufo'
import { hash } from 'ohash'
import type { FetchError } from 'ofetch'
import type { NitroFetchOptions } from 'nitropack'
import type { WatchSource } from 'vue'
import type { AsyncData, AsyncDataOptions } from 'nuxt/app'
import { toValue } from '@vueuse/core'
import type { MaybeRefOrGetter } from '@vueuse/core'
import type { ModuleOptions } from '../../module'
import { createAuthHeader, getProxyPath, headersToObject } from '../utils'
import { useAsyncData, useRuntimeConfig } from '#imports'

type UseKirbyDataOptions<T> = Omit<AsyncDataOptions<T>, 'watch'> & Pick<
  NitroFetchOptions<string>,
  | 'onRequest'
  | 'onRequestError'
  | 'onResponse'
  | 'onResponseError'
  | 'query'
  | 'headers'
  | 'method'
  | 'body'
  | 'retry'
  | 'retryDelay'
  | 'timeout'
> & {
  /**
   * Language code to fetch data for in multi-language Kirby setups.
   */
  language?: MaybeRefOrGetter<string>
  /**
   * Cache the response between function calls for the same path.
   * @default true
   */
  cache?: boolean
  /**
   * Watch an array of reactive sources and auto-refresh the fetch result when they change.
   * Path and language are watched by default. You can completely ignore reactive sources by using `watch: false`.
   * @default undefined
   */
  watch?: (WatchSource<unknown> | object)[] | false
}

export function useKirbyData<T = any>(
  path: MaybeRefOrGetter<string>,
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
    query,
    headers,
    method,
    body,
    language,
    cache = true,
    ...fetchOptions
  } = opts

  const kql = useRuntimeConfig().public.kql as Required<ModuleOptions>
  const _language = computed(() => toValue(language))
  const _path = computed(() => {
    const value = toValue(path).replace(/^\//, '')
    return _language.value ? joinURL(_language.value, value) : value
  })
  const key = computed(() => `$kirby${hash([
    _path.value,
    query,
    method,
  ])}`)

  if (!_path.value || (_language.value && !_path.value.replace(new RegExp(`^${_language.value}/`), '')))
    console.warn('[useKirbyData] Empty Kirby path')

  const asyncDataOptions: AsyncDataOptions<T> = {
    server,
    lazy,
    default: defaultFn,
    transform,
    pick,
    watch: watch === false
      ? []
      : [
          _path,
          ...(watch || []),
        ],
    immediate,
  }

  let controller: AbortController | undefined

  return useAsyncData<T, FetchError>(
    key.value,
    async (nuxt) => {
      controller?.abort?.()

      // Workaround to persist response client-side
      // https://github.com/nuxt/nuxt/issues/15445
      if ((nuxt!.isHydrating || cache) && nuxt!.payload.data[key.value])
        return nuxt!.payload.data[key.value]

      controller = new AbortController()

      try {
        let result: T | undefined

        if (kql.client) {
          result = (await globalThis.$fetch<T>(_path.value, {
            ...fetchOptions,
            signal: controller.signal,
            baseURL: kql.url,
            query,
            headers: {
              ...headersToObject(headers),
              ...createAuthHeader(kql),
            },
            method,
            body,
          })) as T
        }
        else {
          result = (await globalThis.$fetch<T>(getProxyPath(key.value), {
            ...fetchOptions,
            signal: controller.signal,
            method: 'POST',
            body: {
              path: _path.value,
              query,
              headers: headersToObject(headers),
              method,
              body,
              cache,
            },
          })) as T
        }

        if (cache)
          nuxt!.payload.data[key.value] = result

        return result
      }
      catch (error) {
        // Invalidate cache if request fails
        nuxt!.payload.data[key.value] = undefined

        throw error
      }
    },
    asyncDataOptions,
  ) as AsyncData<T, FetchError>
}
