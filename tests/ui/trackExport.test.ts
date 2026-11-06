import { expect, it } from 'vitest'
import { serializeTrack } from '@/infrastructure/export/trackExport'
import { createStarterTrack } from '@/domain/track/starterTrack'
import { asTrackId } from '@/domain/model'
it('exports all authored track data in a portable versioned JSON file', () => {
 const track=createStarterTrack(asTrackId('export'),1)
 const result=serializeTrack({...track,name:'Ramp / debug'})
 expect(result.filename).toBe('Ramp-debug.trackforge.json')
 const parsed=JSON.parse(result.content)
 expect(parsed.format).toBe('trackforge-track')
 expect(parsed.formatVersion).toBe(1)
 expect(parsed.track).toEqual({...track,name:'Ramp / debug'})
})
