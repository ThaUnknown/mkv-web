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

const readSeekHead = async (seekHeadStream, segmentStart, readStream = () => {}) => {
  const seekHeadTags = await readUntilTag(seekHeadStream, EbmlTagId.SeekHead, [EbmlTagId.SeekHead])
  const seekHead = readChildren(seekHeadTags)
  // Determines if there is a second SeekHead referenced by the first SeekHead.
  // Note: If true, the first must *only* contains a reference to the second, so no other tags will be in the first.
  const recursive = seekHead.Children.find((child) => {
    return child.Seek.SeekID === EbmlTagId.SeekHead
  })

  if (recursive) {
    const seekHeadStream = readStream({ start: recursive.Seek.SeekPosition + segmentStart })
    const recursiveSeek = await readSeekHead(seekHeadStream, segmentStart, readStream)
    return recursiveSeek
  } else {
    return seekHead
  }
}

export class Metadata {
  constructor (blob) {
    this.blob = blob // must have .createReadStream method.
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
      return readSeekHead(seekHeadStream, 0, this.blob.createReadStream).then((seekHead) => {
        this.seekHead = seekHead // Note, this is already parsed in readSeekHead, should probably change this?
        return this.seekHead
      })
    }
    return this.seekHead
  }

  async getInfo () {
    if (!this.segmentStart) {
      throw new Error('Segment must be read before SeekHead')
    }

    if (!this.info) {
      const seekHeadInfo = this.seekHead.Children.find((seek) => {
        const seekId = parseInt(seek.Seek.SeekID.toString('hex'), 16)
        return seekId === EbmlTagId.Info
      })

      if (!seekHeadInfo) return Promise.resolve({})

      const infoStream = this.blob.slice(this.segmentStart + seekHeadInfo.Seek.SeekPosition).stream()
      return readUntilTag(infoStream, EbmlTagId.Info, true).then((info) => {
        this.info = readChildren(info, this.segmentStart + seekHeadInfo.Seek.SeekPosition)
        return this.info
      })
    }
    return this.info
  }

  async getTracks () {
    if (!this.segmentStart) {
      throw new Error('Segment must be read before SeekHead')
    }

    if (this.tracks.length === 0) {
      const seekHeadTracks = this.seekHead.Children.find((seek) => {
        const seekId = parseInt(seek.Seek.SeekID.toString('hex'), 16)
        return seekId === EbmlTagId.Tracks
      })

      if (!seekHeadTracks) return Promise.resolve([])

      const tracksStream = this.blob.slice(this.segmentStart + seekHeadTracks.Seek.SeekPosition).stream()
      return readUntilTag(tracksStream, EbmlTagId.Tracks, true).then((tracks) => {
        this.tracks = readChildren(tracks, this.segmentStart + seekHeadTracks.Seek.SeekPosition)
        return this.tracks
      })
    }
    return this.tracks
  }

  async getChapters () {
    if (!this.segmentStart) {
      throw new Error('Segment must be read before SeekHead')
    }

    if (this.chapters.length === 0) {
      const seekHeadChapters = this.seekHead.Children.find((seek) => {
        const seekId = parseInt(seek.Seek.SeekID.toString('hex'), 16)
        return seekId === EbmlTagId.Chapters
      })

      if (!seekHeadChapters) return Promise.resolve([])

      const chaptersStream = this.blob.slice(this.segmentStart + seekHeadChapters.Seek.SeekPosition).stream()
      return readUntilTag(chaptersStream, EbmlTagId.Chapters, true).then((chapters) => {
        this.chapters = readChildren(chapters, this.segmentStart + seekHeadChapters.Seek.SeekPosition)
        return this.chapters
      })
    }
    return this.chapters
  }

  async getClusters () {
    if (!this.segmentStart) {
      throw new Error('Segment must be read before SeekHead')
    }

    if (this.clusters.length === 0) {
      const seekHeadClusters = this.seekHead.Children.find((seek) => {
        const seekId = parseInt(seek.Seek.SeekID.toString('hex'), 16)
        return seekId === EbmlTagId.Clusters
      })

      if (!seekHeadClusters) return Promise.resolve([])

      const clustersStream = this.blob.slice(this.segmentStart + seekHeadClusters.Seek.SeekPosition).stream()
      return readUntilTag(clustersStream, EbmlTagId.Clusters, true).then((clusters) => {
        this.clusters = readChildren(clusters, this.segmentStart + seekHeadClusters.Seek.SeekPosition)
        return this.clusters
      })
    }
    return this.clusters
  }

  async getCues () {
    if (!this.segmentStart) {
      throw new Error('Segment must be read before SeekHead')
    }

    if (this.cues.length === 0) {
      const seekHeadCues = this.seekHead.Children.find((seek) => {
        const seekId = parseInt(seek.Seek.SeekID.toString('hex'), 16)
        return seekId === EbmlTagId.Cues
      })

      if (!seekHeadCues) return Promise.resolve([])

      const cuesStream = this.blob.slice(this.segmentStart + seekHeadCues.Seek.SeekPosition).stream()
      return readUntilTag(cuesStream, EbmlTagId.Cues, true).then((cues) => {
        this.cues = readChildren(cues, this.segmentStart + seekHeadCues.Seek.SeekPosition)
        return this.cues
      })
    }
    return this.cues
  }

  async getAttachments () {
    if (!this.segmentStart) {
      throw new Error('Segment must be read before SeekHead')
    }

    if (this.attachments.length === 0) {
      const seekHeadAttachments = this.seekHead.Children.find((seek) => {
        const seekId = parseInt(seek.Seek.SeekID.toString('hex'), 16)
        return seekId === EbmlTagId.Attachments
      })

      if (!seekHeadAttachments) return Promise.resolve([])

      const attachmentsStream = this.blob.slice(this.segmentStart + seekHeadAttachments.Seek.SeekPosition).stream()
      return readUntilTag(attachmentsStream, EbmlTagId.Attachments, true).then((attachments) => {
        this.attachments = readChildren(attachments, this.segmentStart + seekHeadAttachments.Seek.SeekPosition)
        return this.attachments
      })
    }
    return this.attachments
  }

  async getTags () {
    if (!this.segmentStart) {
      throw new Error('Segment must be read before SeekHead')
    }

    if (this.tags.length === 0) {
      const seekHeadTags = this.seekHead.Children.find((seek) => {
        const seekId = parseInt(seek.Seek.SeekID.toString('hex'), 16)
        return seekId === EbmlTagId.Tags
      })

      if (!seekHeadTags) return Promise.resolve([])

      const tagsStream = this.blob.slice(this.segmentStart + seekHeadTags.Seek.SeekPosition).stream()
      return readUntilTag(tagsStream, EbmlTagId.Tags, true).then((tags) => {
        this.tags = readChildren(tags, this.segmentStart + seekHeadTags.Seek.SeekPosition)
        return this.tags
      })
    }
    return this.tags
  }
}

const main = async () => {
  const metadata = new Metadata(await openAsBlob('./media/video2.webm'))
  const Segment = await metadata.getSegment()
  const SeekHead = await metadata.getSeekHead()
  const Info = await metadata.getInfo()
  const Tracks = await metadata.getTracks()
  const Chapters = await metadata.getChapters()
  const Clusters = await metadata.getClusters()
  const Cues = await metadata.getCues()
  const Attachments = await metadata.getAttachments()
  const Tags = await metadata.getTags()

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
