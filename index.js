import EbmlIteratorDecoder from 'ebml-iterator/src/EbmlIteratorDecoder.js'
import EbmlTagId from 'ebml-iterator/src/models/enums/EbmlTagId.js'
import EbmlElementType from 'ebml-iterator/src/models/enums/EbmlElementType.js'
import 'fast-readable-async-iterator'

import { openAsBlob } from 'node:fs'

const readUntilTag = async (stream, tagId, buffer = false, maximum = null) => {
  if (!stream) throw new Error('stream is required')
  if (!tagId) throw new Error('tagId is required')

  const decoder = new EbmlIteratorDecoder({ stream, bufferTagIds: buffer ? [tagId] : [] })

  for await (const tag of decoder) {
    const offset = decoder._currentBufferOffset
    if (maximum && offset > maximum) return null // Return early if we've exceeded the maximum buffer size

    if (tag.id === tagId) {
      return tag
    }
  }
  return null
}

const readChildren = (parent = {}, start = 0) => {
  const children = []

  if (!parent) throw new Error('Parent object is required')
  if (!parent.Children) parent.Children = []

  parent.Children.forEach((Child) => {
    const childOutput = {}
    const childName = EbmlTagId[Child.id] || Child.id
    if (Child.Children && Child.Children.length > 0) {
      const subChildren = readChildren(Child)
      delete subChildren._children
      childOutput[childName] = subChildren.Children
        .reduce((acc, cur) => {
          return { ...acc, ...cur }
        }, {})
    } else {
      if (Child.type === EbmlElementType.String || Child.type === EbmlElementType.UTF8 || Child.type == null) {
        childOutput[childName] = Child.data.toString()
      } else {
        childOutput[childName] = Child.data
      }
    }
    children.push(childOutput)
  })

  delete parent._children
  if (start) parent.absoluteStart = start
  return { ...parent, Children: children }
}

const readSeekHead = async (seekHeadStream, segmentStart) => {
  const seekHeadTags = await readUntilTag(seekHeadStream, EbmlTagId.SeekHead, [EbmlTagId.SeekHead])
  if (!seekHeadTags) throw new Error('Couldn\'t find seek head');
  const seekHead = readChildren(seekHeadTags)
  // Determines if there is a second SeekHead referenced by the first SeekHead.
  // Note: If true, the first must *only* contains a reference to the second, so no other tags will be in the first.

  const transformedHead = {}

  seekHead.Children.forEach(child => {
    if (!child.Seek) return; // CRC32 elements will appear, currently we don't check them
    transformedHead[EbmlTagId[new DataView(child.Seek.SeekID.buffer).getUint32()]] = child.Seek.SeekPosition;
  })

  if (transformedHead.SeekHead) {
    const seekHeadStream = this.blob.slice(transformedHead.SeekHead + segmentStart).stream();
    return readSeekHead(seekHeadStream, segmentStart)
  } else {
    return transformedHead
  }
}

export class Metadata {
  constructor (blob) {
    this.blob = blob
    this.segment = null
    this.segmentStart = null
    this.seekHead = null
    this.Info = []
    this.Tracks = []
    this.Chapters = []
    this.Clusters = []
    this.Cues = []
    this.Attachments = []
    this.Tags = []
  }

  async getSegment () {
    if (!this.segment) {
      const segmentStream = this.blob.stream()
      return readUntilTag(segmentStream, EbmlTagId.Segment).then((segment) => {
        this.segment = readChildren(segment)
        this.segmentStart = segment.absoluteStart + segment.tagHeaderLength
        return this.segment
      })
    }
    return this.segment
  }

  async getSeekHead () {
    if (!this.segment) {
      throw new Error('Segment must be read before SeekHead')
    }

    if (!this.seekHead) {
      console.log(this.segment)
      const seekHeadStream = this.blob.slice(this.segment.absoluteStart + this.segment.tagHeaderLength).stream()
      return readSeekHead(seekHeadStream, 0).then((seekHead) => {
        this.seekHead = seekHead // Note, this is already parsed in readSeekHead, should probably change this?
        return this.seekHead
      })
    }
    return this.seekHead
  }

  async readSeekedTag (tag) {
    if (!this.segmentStart) {
      throw new Error('Segment must be read before SeekHead')
    }

    if (this[tag].length === 0) {
      if (!this.seekHead[tag]) return Promise.resolve([])

      const stream = this.blob.slice(this.segmentStart + this.seekHead[tag]).stream()
      return readUntilTag(stream, EbmlTagId[tag], true).then((child) => {
        this[tag] = readChildren(child, this.segmentStart + this.seekHead[tag])
        return this[tag]
      })
    }
    return this[tag]
  }
}

const main = async () => {
  const metadata = new Metadata(await openAsBlob('./media/video1.webm'))
  const Segment = await metadata.getSegment()
  const SeekHead = await metadata.getSeekHead()
  const Info = await metadata.readSeekedTag("Info")
  const Tracks = await metadata.readSeekedTag("Tracks")
  const Chapters = await metadata.readSeekedTag("Chapters")
  const Clusters = await metadata.readSeekedTag("Clusters")
  const Cues = await metadata.readSeekedTag("Cues")
  const Attachments = await metadata.readSeekedTag("Attachments")
  const Tags = await metadata.readSeekedTag("Tags")

  console.log('Segment', Segment)
  console.log('SeekHead', SeekHead)
  console.log('Info', Info)
  console.log('Tracks', Tracks)
  console.log('Chapters', Chapters)
  console.log('Clusters', Clusters)
  console.log('Cues', Cues)
  console.log('Attachments', Attachments)
  console.log('Tags', Tags)
}

main().catch(console.error)
