import EbmlIteratorDecoder from 'ebml-iterator/src/EbmlIteratorDecoder.js'
import Tools from 'ebml-iterator/src/tools.js'
import EbmlTagId from 'ebml-iterator/src/models/enums/EbmlTagId.js'
import EbmlElementType from 'ebml-iterator/src/models/enums/EbmlElementType.js'
import 'fast-readable-async-iterator'

import { openAsBlob } from 'node:fs'

const readUntilTag = async (stream, tagId, bufferTag = true) => {
  if (!stream) throw new Error('stream is required')
  if (!tagId) throw new Error('tagId is required')

  const decoder = new EbmlIteratorDecoder({ stream, bufferTagIds: bufferTag ? [tagId] : [] })

  for await (const tag of decoder) {
    const offset = decoder._currentBufferOffset
    if (maximum && offset > maximum) return null // Return early if we've exceeded the maximum buffer size

    if (tag.id === tagId) {
      return tag
    }
  }
  return null
}

/**
 * @param {Object} parent
 */
const readChildren = (parent = {}, start = 0) => {
  const Children = []

  if (!parent) throw new Error('Parent object is required')
  if (!parent.Children) parent.Children = []

  for (const Child of parent.Children) {
    const childOutput = {}
    const childName = EbmlTagId[Child.id] || Child.id
    if (Child.Children && Child.Children.length > 0) {
      const subChildren = readChildren(Child)
      delete subChildren._children
      childOutput[childName] = subChildren.Children.reduce((acc, cur) => ({ ...acc, ...cur }), {})
    } else {
      if (Child.type === EbmlElementType.String || Child.type === EbmlElementType.UTF8 || Child.type == null) {
        childOutput[childName] = Child.data.toString()
      } else {
        childOutput[childName] = Child.data
      }
    }
    Children.push(childOutput)
  }

  delete parent._children
  if (start) parent.absoluteStart = start
  return { ...parent, Children }
}

const readChild = (...args) => {
  const res = readChildren(...args)
  const Children = res.Children.reduce((acc, cur) => ({ ...acc, ...cur }), {})
  return { ...res, Children }
}

const readSeekHead = async (seekHeadStream, segmentStart, blob) => {
  const seekHeadTags = await readUntilTag(seekHeadStream, EbmlTagId.SeekHead)
  if (!seekHeadTags) throw new Error('Couldn\'t find seek head')
  const seekHead = readChildren(seekHeadTags)

  const transformedHead = {}

  for (const child of seekHead.Children) {
    if (!child.Seek) continue // CRC32 elements will appear, currently we don't check them
    const tagName = EbmlTagId[Tools.readUnsigned(child.Seek.SeekID)]
    transformedHead[tagName] = child.Seek.SeekPosition
  }

  // Determines if there is a second SeekHead referenced by the first SeekHead.
  // See: https://www.matroska.org/technical/ordering.html#seekhead
  // Note: If true, the first *must* contain a reference to the second, but other tags can be in the first.
  if (transformedHead.SeekHead) {
    const seekHeadStream = blob.slice(transformedHead.SeekHead + segmentStart).stream()
    const secondSeekHead = await readSeekHead(seekHeadStream, segmentStart, blob)
    return { ...secondSeekHead, ...transformedHead }
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
      const segment = await readUntilTag(this.blob.stream(), EbmlTagId.Segment, false)
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
      const child = await readUntilTag(stream, EbmlTagId[tag])
      this[storedTag] = (multiple ? readChildren(child, this.segmentStart + this.seekHead[tag]) : readChild(child, this.segmentStart + this.seekHead[tag])).Children

      return this[storedTag]
    }
    return this[storedTag]
  }
}

const main = async () => {
  const metadata = new Metadata(await openAsBlob('./media/video2.webm'))
  const Segment = await metadata.getSegment()
  const SeekHead = await metadata.getSeekHead()
  const Info = await metadata.readSeekedTag('Info', false)
  const Tracks = await metadata.readSeekedTag('Tracks')
  const Chapters = await metadata.readSeekedTag('Chapters')
  const Clusters = await metadata.readSeekedTag('Clusters')
  const Cues = await metadata.readSeekedTag('Cues')
  const Attachments = await metadata.readSeekedTag('Attachments')
  const Tags = await metadata.readSeekedTag('Tags')

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
