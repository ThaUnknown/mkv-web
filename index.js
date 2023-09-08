import EbmlIteratorDecoder from 'ebml-iterator/src/EbmlIteratorDecoder.js'
import Tools from 'ebml-iterator/src/tools.js'
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

const readChildren = (parent = {}, start = 0, multiple = true) => {
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
  return { ...parent, Children: multiple ? children : children.reduce((acc, cur) => ({...acc, ...cur}), {})}
}

const readSeekHead = async (seekHeadStream, segmentStart, blob) => {
  const seekHeadTags = await readUntilTag(seekHeadStream, EbmlTagId.SeekHead, [EbmlTagId.SeekHead])
  if (!seekHeadTags) throw new Error('Couldn\'t find seek head')
  const seekHead = readChildren(seekHeadTags)
  // Determines if there is a second SeekHead referenced by the first SeekHead.
  // Note: If true, the first must *only* contains a reference to the second, so no other tags will be in the first.

  const transformedHead = {}

  for (const child of seekHead.Children) {
    if (!child.Seek) return // CRC32 elements will appear, currently we don't check them
    const tagName = EbmlTagId[Tools.readUnsigned(child.Seek.SeekID)]
    transformedHead[tagName] = child.Seek.SeekPosition
  }

  if (transformedHead.SeekHead) {
    const seekHeadStream = blob.slice(transformedHead.SeekHead + segmentStart).stream()
    return readSeekHead(seekHeadStream, segmentStart, blob)
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
    this.info = null
    this.tracks = []
    this.chapters = []
    this.clusters = []
    this.cues = []
    this.attachments = []
    this.tags = []
  }

  async getSegment () {
    if (!this.segment) {
      const segmentStream = this.blob.stream()
      const segment = await readUntilTag(segmentStream, EbmlTagId.Segment)
      this.segment = readChildren(segment)
      this.segmentStart = segment.absoluteStart + segment.tagHeaderLength
      return this.segment
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
      const seekHead = await readSeekHead(seekHeadStream, 0, this.blob)
      this.seekHead = seekHead // Note, this is already parsed in readSeekHead, should probably change this?
      return this.seekHead
    }
    return this.seekHead
  }

  async readSeekedTag (tag, multiple = true) {
    if (!this.segmentStart) {
      throw new Error('Segment must be read before SeekHead')
    }

    const storedTag = tag.toLowerCase()

    if ((!multiple && !this[storedTag]) || this[storedTag]?.length === 0) {
      if (!this.seekHead[tag]) return multiple ? [] : null

      const stream = this.blob.slice(this.segmentStart + this.seekHead[tag]).stream()
      const child = await readUntilTag(stream, EbmlTagId[tag], true)
      this[storedTag] =  readChildren(child, this.segmentStart + this.seekHead[tag], multiple).Children

      return this[storedTag]
    }
    return this[storedTag]
  }
}

const main = async () => {
  const metadata = new Metadata(await openAsBlob('./media/video1.webm'))
  const Segment = await metadata.getSegment()
  const SeekHead = await metadata.getSeekHead()
  const Info = await metadata.readSeekedTag('Info', false)
  const Tracks = await metadata.readSeekedTag('Tracks', true)
  const Chapters = await metadata.readSeekedTag('Chapters', true)
  const Clusters = await metadata.readSeekedTag('Clusters', true)
  const Cues = await metadata.readSeekedTag('Cues', true)
  const Attachments = await metadata.readSeekedTag('Attachments', true)
  const Tags = await metadata.readSeekedTag('Tags', true)

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
