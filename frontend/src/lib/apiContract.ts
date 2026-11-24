/**
 * Compile-time contract between the hand-written client types (types.ts) and
 * the backend's generated OpenAPI schema (openapi.d.ts).
 *
 * If a backend model gains, loses or renames a field, `tsc` fails here with
 * the field names, instead of the UI silently reading `undefined`.
 * Regenerate the schema with: python -m cratedigger_api.openapi && npm run api:generate
 */
import type { components } from './openapi'
import type * as Client from './types'

type Schemas = components['schemas']

/** `true` when both types declare exactly the same field names. */
type SameFields<ClientType, SchemaType> =
  [Exclude<keyof ClientType, keyof SchemaType>, Exclude<keyof SchemaType, keyof ClientType>] extends [never, never]
    ? true
    : { onlyInClient: Exclude<keyof ClientType, keyof SchemaType>; onlyInSchema: Exclude<keyof SchemaType, keyof ClientType> }

export const apiContract: {
  Track: SameFields<Client.Track, Schemas['Track']>
  TrackPage: SameFields<Client.TrackPage, Schemas['TrackPage']>
  TrackLocation: SameFields<Client.TrackLocation, Schemas['TrackLocation']>
  QueueJob: SameFields<Client.QueueJob, Schemas['QueueJob']>
  QueuePage: SameFields<Client.QueuePage, Schemas['QueuePage']>
  QueueSummary: SameFields<Client.QueueSummary, Schemas['QueueSummary']>
  Suggestion: SameFields<Client.Suggestion, Schemas['Suggestion']>
  DiscoveryResponse: SameFields<Client.DiscoveryResponse, Schemas['DiscoveryResponse']>
  MpcJob: SameFields<Client.MpcJob, Schemas['MpcJob']>
  Crate: SameFields<Client.Crate, Schemas['Crate']>
  CrateRef: SameFields<Client.CrateRef, Schemas['CrateRef']>
  CrateOverview: SameFields<Client.CrateOverview, Schemas['CrateOverview']>
  CrateDetail: SameFields<Client.CrateDetail, Schemas['CrateDetail']>
  CrateAssignmentResult: SameFields<Client.CrateAssignmentResult, Schemas['CrateAssignmentResult']>
  CrateSuggestion: SameFields<Client.CrateSuggestion, Schemas['CrateSuggestion']>
  ConfigResponse: SameFields<Client.ConfigResponse, Schemas['ConfigResponse']>
  PreviewResponse: SameFields<Client.PreviewResponse, Schemas['PreviewResponse']>
  PreviewPrefetchItem: SameFields<Client.PreviewPrefetchItem, Schemas['PreviewPrefetchItem']>
  PreviewPrefetchResponse: SameFields<Client.PreviewPrefetchResponse, Schemas['PreviewPrefetchResponse']>
  ListeningEntry: SameFields<Client.ListeningEntry, Schemas['ListeningEntry']>
  ListeningPage: SameFields<Client.ListeningPage, Schemas['ListeningPage']>
} = {
  Track: true,
  TrackPage: true,
  TrackLocation: true,
  QueueJob: true,
  QueuePage: true,
  QueueSummary: true,
  Suggestion: true,
  DiscoveryResponse: true,
  MpcJob: true,
  Crate: true,
  CrateRef: true,
  CrateOverview: true,
  CrateDetail: true,
  CrateAssignmentResult: true,
  CrateSuggestion: true,
  ConfigResponse: true,
  PreviewResponse: true,
  PreviewPrefetchItem: true,
  PreviewPrefetchResponse: true,
  ListeningEntry: true,
  ListeningPage: true,
}
