import { empty, throwError, Observable, Observer, OperatorFunction } from 'rxjs'
import { catchError, finalize, map, mergeAll,  startWith, tap } from 'rxjs/operators'

export type PageToken = string & { kind: 'PageToken' }

export const emptyPageToken = '' as PageToken

export interface State<T = {}> {
  urlPath: string

  pageSize?: number
  urlQuery?: {}

  nextPageToken: PageToken
  totalSize?: number
  result: T[]

  nextPage: number
  hasMore: boolean
}

export function defaultState<T>(
  urlPath: string,
  options: {
    pageSize?: number
    urlQuery?: {}
  } = {}
): State<T> {
  const raw: State<T> = {
    urlPath: urlPath,
    nextPageToken: emptyPageToken,
    totalSize: undefined,
    result: [],

    nextPage: 1,
    hasMore: true
  }
  if (options.pageSize) {
    Object.assign(raw, { pageSize: options.pageSize })
  }
  if (options.urlQuery) {
    const { pageSize, ...nonPaginationQuery } = options.urlQuery as any
    Object.assign(raw, { urlQuery: nonPaginationQuery })
    if (!raw.pageSize && pageSize) {
      raw.pageSize = pageSize
    }
  }
  return raw
}

export type OriginalResponse<T> = {
  nextPageToken: PageToken
  result: T[]
  totalSize?: number
}

export const accumulateResultByConcat = <T>(state: State<T>, resp: OriginalResponse<T>): State<T> => {
  return {
    ...state,
    totalSize: resp.totalSize,
    nextPageToken: resp.nextPageToken,
    result: state.result.concat(resp.result),
    nextPage: state.nextPage + 1,
    hasMore: Boolean(resp.nextPageToken) && resp.result.length === state.pageSize
  }
}

export const loadAndExpand = <T>(
  step: (curr: State<T>) => Observable<OriginalResponse<T>>,
  initState: State<T>,
  loadMore$: Observable<{}> = empty()
): Observable<State<T>> => {
  return loadMore$
    .pipe(
      startWith({}),
      expand(step, accumulateResultByConcat, initState),
      mergeAll()
    )
}

export const expand = <T>(
  step: (curr: State<T>) => Observable<OriginalResponse<T>>,
  accumulator: (state: State<T>, resp: OriginalResponse<T>) => State<T>,
  initState: State<T>
): OperatorFunction<{}, Observable<State<T>>> => (
  source$
) => {
  const state = { ...initState }
  let isLoading = false

  return Observable.create((observer: Observer<Observable<State<T>>>) => {
    const subs = source$.subscribe({
      next: (_) => {
        if (!state.hasMore) {
          observer.complete()
          return
        }
        if (!isLoading) {
          isLoading = true
          observer.next(step(state)
            .pipe(
              map((stepResult) => accumulator(state, stepResult)),
              tap((expanded) => Object.assign(state, expanded)),
              catchError((err) => throwError(err)),
              finalize(() => { isLoading = false })
            )
          )
        }
      },
      error: (err) => {
        isLoading = false
        observer.error(err)
      },
      complete: () => {
        observer.complete()
      }
    })

    return () => {
      subs.unsubscribe()
    }
  }) as Observable<Observable<State<T>>>
}
