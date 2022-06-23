import { defineEventHandler, useBody } from 'h3'
import type { ModuleOptions } from '../../../module'
import type { KirbyQueryRequest, KirbyQueryResponse } from '../../types'
import { getAuthHeaders } from '../../utils'
import { useRuntimeConfig } from '#imports'

export default defineEventHandler(async (event): Promise<KirbyQueryResponse> => {
  const body = await useBody(event)

  const query: Partial<KirbyQueryRequest> = body.query || {}

  if (Object.keys(query).length === 0 || !query?.query) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Empty KQL query',
    })
  }

  const { kql } = useRuntimeConfig()

  try {
    return await $fetch<KirbyQueryResponse>(kql.prefix, {
      baseURL: kql.url,
      method: 'POST',
      body: query,
      headers: getAuthHeaders(kql as ModuleOptions),
    })
  }
  catch (err) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Couldn\'t execute KQL query',
      // `err.message` is the error message from `$fetch`
      data: err.message,
    })
  }
})
