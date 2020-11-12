'use strict';

const _ = require('ep_etherpad-lite/static/js/underscore');
const randomString = require('ep_etherpad-lite/static/js/pad_utils').randomString;
const shared = require('./shared');

exports.addTextOnClipboard = function (e, ace, padInner, removeSelection, comments, replies) {
  let commentIdOnFirstPositionSelected;
  let hasCommentOnSelection;
  ace.callWithAce((ace) => {
    commentIdOnFirstPositionSelected = ace.ace_getCommentIdOnFirstPositionSelected();
    hasCommentOnSelection = ace.ace_hasCommentOnSelection();
  });

  if (hasCommentOnSelection) {
    let commentsData;
    const range = padInner.contents()[0].getSelection().getRangeAt(0);
    const rawHtml = createHiddenDiv(range);
    let html = rawHtml;
    const onlyTextIsSelected = selectionHasOnlyText(rawHtml);

    // when the range selection is fully inside a tag, 'rawHtml' will have no HTML tag, so we have to
    // build it. Ex: if we have '<span>ab<b>cdef</b>gh</span>" and user selects 'de', the value of
    // 'rawHtml' will be 'de', not '<b>de</b>'. As it is not possible to have two comments in the same text
    // commentIdOnFirstPositionSelected is the commentId in this partial selection
    if (onlyTextIsSelected) {
      const textSelected = rawHtml[0].textContent;
      html = buildHtmlToCopyWhenSelectionHasOnlyText(textSelected, range, commentIdOnFirstPositionSelected);
    }
    const commentIds = getCommentIds(html);
    commentsData = buildCommentsData(html, comments);
    const htmlToCopy = replaceCommentIdsWithFakeIds(commentsData, html);
    commentsData = JSON.stringify(commentsData);
    let replyData = getReplyData(replies, commentIds);
    replyData = JSON.stringify(replyData);
    e.originalEvent.clipboardData.setData('text/objectReply', replyData);
    e.originalEvent.clipboardData.setData('text/objectComment', commentsData);
    // here we override the default copy behavior
    e.originalEvent.clipboardData.setData('text/html', htmlToCopy);
    e.preventDefault();

    // if it is a cut event we have to remove the selection
    if (removeSelection) {
      padInner.contents()[0].execCommand('delete');
    }
  }
};

const getReplyData = function (replies, commentIds) {
  let replyData = {};
  _.each(commentIds, (commentId) => {
    replyData = _.extend(getRepliesFromCommentId(replies, commentId), replyData);
  });
  return replyData;
};

const getRepliesFromCommentId = function (replies, commentId) {
  const repliesFromCommentID = {};
  _.each(replies, (reply, replyId) => {
    if (reply.commentId === commentId) {
      repliesFromCommentID[replyId] = reply;
    }
  });
  return repliesFromCommentID;
};

const buildCommentIdToFakeIdMap = function (commentsData) {
  const commentIdToFakeId = {};
  _.each(commentsData, (comment, fakeCommentId) => {
    const commentId = comment.data.originalCommentId;
    commentIdToFakeId[commentId] = fakeCommentId;
  });
  return commentIdToFakeId;
};

const replaceCommentIdsWithFakeIds = function (commentsData, html) {
  const commentIdToFakeId = buildCommentIdToFakeIdMap(commentsData);
  _.each(commentIdToFakeId, (fakeCommentId, commentId) => {
    $(html).find(`.${commentId}`).removeClass(commentId).addClass(fakeCommentId);
  });
  const htmlWithFakeCommentIds = getHtml(html);
  return htmlWithFakeCommentIds;
};

const buildCommentsData = function (html, comments) {
  const commentsData = {};
  const originalCommentIds = getCommentIds(html);
  _.each(originalCommentIds, (originalCommentId) => {
    const fakeCommentId = generateFakeCommentId();
    const comment = comments[originalCommentId];
    comment.data.originalCommentId = originalCommentId;
    commentsData[fakeCommentId] = comment;
  });
  return commentsData;
};

const generateFakeCommentId = function () {
  const commentId = `fakecomment-${randomString(16)}`;
  return commentId;
};

const getCommentIds = function (html) {
  const allSpans = $(html).find('span');
  const commentIds = [];
  _.each(allSpans, (span) => {
    const cls = $(span).attr('class');
    const classCommentId = /(?:^| )(c-[A-Za-z0-9]*)/.exec(cls);
    const commentId = (classCommentId) ? classCommentId[1] : false;
    if (commentId) {
      commentIds.push(commentId);
    }
  });
  const uniqueCommentIds = _.uniq(commentIds);
  return uniqueCommentIds;
};

const createHiddenDiv = function (range) {
  const content = range.cloneContents();
  const div = document.createElement('div');
  const hiddenDiv = $(div).html(content);
  return hiddenDiv;
};

const getHtml = function (hiddenDiv) {
  return $(hiddenDiv).html();
};

const selectionHasOnlyText = function (rawHtml) {
  const html = getHtml(rawHtml);
  const htmlDecoded = htmlDecode(html);
  const text = $(rawHtml).text();
  return htmlDecoded === text;
};

const buildHtmlToCopyWhenSelectionHasOnlyText = function (text, range, commentId) {
  const htmlWithSpans = buildHtmlWithTwoSpanTags(text, commentId);
  const html = buildHtmlWithFormattingTagsOfSelection(htmlWithSpans, range);

  const htmlToCopy = $.parseHTML(`<div>${html}</div>`);
  return htmlToCopy;
};

const buildHtmlWithFormattingTagsOfSelection = function (html, range) {
  const htmlOfParentNode = range.commonAncestorContainer.parentNode;
  const tags = getTagsInSelection(htmlOfParentNode);

  // this case happens when we got a selection with one or more styling (bold, italic, underline, strikethrough)
  // applied in all selection in the same range. For example, <b><i><u>text</u></i></b>
  if (tags) {
    html = buildOpenTags(tags) + html + buildCloseTags(tags);
  }

  return html;
};

// FIXME - Allow to copy a comment when user copies only one char
// This is a hack to preserve the comment classes when user pastes a comment. When user pastes a span like this
// <span class='comment c-124'>thing</span>, chrome removes the classes and keeps only the style of the class. With comments
// chrome keeps the background-color. To avoid this we create two spans. The first one, <span class='comment c-124'>thi</span>
// has the text until the last but one character and second one with the last character <span class='comment c-124'>g</span>.
// Etherpad does a good job joining the two spans into one after the paste is triggered.
const buildHtmlWithTwoSpanTags = function (text, commentId) {
  const firstSpan = `<span class="comment ${commentId}">${text.slice(0, -1)}</span>`; // text until before last char
  const secondSpan = `<span class="comment ${commentId}">${text.slice(-1)}</span>`; // last char

  return firstSpan + secondSpan;
};

const buildOpenTags = function (tags) {
  let openTags = '';
  tags.forEach((tag) => {
    openTags += `<${tag}>`;
  });
  return openTags;
};

const buildCloseTags = function (tags) {
  let closeTags = '';
  var tags = tags.reverse();
  tags.forEach((tag) => {
    closeTags += `</${tag}>`;
  });
  return closeTags;
};

const getTagsInSelection = function (htmlObject) {
  const tags = [];
  let tag;
  while ($(htmlObject)[0].localName !== 'span') {
    const html = $(htmlObject).prop('outerHTML');
    const stylingTagRegex = /<(b|i|u|s)>/.exec(html);
    tag = stylingTagRegex ? stylingTagRegex[1] : '';
    tags.push(tag);
    htmlObject = $(htmlObject).parent();
  }
  return tags;
};

exports.saveCommentsAndReplies = function (e) {
  let comments = e.originalEvent.clipboardData.getData('text/objectComment');
  let replies = e.originalEvent.clipboardData.getData('text/objectReply');
  if (comments && replies) {
    comments = JSON.parse(comments);
    replies = JSON.parse(replies);
    saveComments(comments);
    saveReplies(replies);
  }
};

const saveComments = function (comments) {
  const commentsToSave = {};
  const padId = clientVars.padId;

  const mapOriginalCommentsId = pad.plugins.ep_comments_page.mapOriginalCommentsId;
  const mapFakeComments = pad.plugins.ep_comments_page.mapFakeComments;

  _.each(comments, (comment, fakeCommentId) => {
    const newCommentId = shared.generateCommentId();
    mapFakeComments[fakeCommentId] = newCommentId;
    const originalCommentId = comment.data.originalCommentId;
    mapOriginalCommentsId[originalCommentId] = newCommentId;
    commentsToSave[newCommentId] = comment;
  });
  pad.plugins.ep_comments_page.saveCommentWithoutSelection(padId, commentsToSave);
};

const saveReplies = function (replies) {
  const repliesToSave = {};
  const padId = clientVars.padId;
  const mapOriginalCommentsId = pad.plugins.ep_comments_page.mapOriginalCommentsId;
  _.each(replies, (reply, replyId) => {
    const originalCommentId = reply.commentId;
    // as the comment copied has got a new commentId, we set this id in the reply as well
    reply.commentId = mapOriginalCommentsId[originalCommentId];
    repliesToSave[replyId] = reply;
  });
  pad.plugins.ep_comments_page.saveCommentReplies(padId, repliesToSave);
};

// copied from https://css-tricks.com/snippets/javascript/unescape-html-in-js/
const htmlDecode = function (input) {
  const e = document.createElement('div');
  e.innerHTML = input;
  return e.childNodes.length === 0 ? '' : e.childNodes[0].nodeValue;
};

// here we find the comment id on a position [line, column]. This function is used to get the comment id
// of one line when there is ONLY text selected. E.g In the line with comment, <span class='comment...'>something</span>,
// and user copies the text 'omethin'. The span tags are not copied only the text. So as the comment is
// applied on the selection we get the commentId using the first position selected of the line.
// P.S: It's not possible to have two or more comments when there is only text selected, because for each comment
// created it's generated a <span> and to copy only the text it MUST NOT HAVE any tag on the selection
exports.getCommentIdOnFirstPositionSelected = function () {
  const attributeManager = this.documentAttributeManager;
  const rep = this.rep;
  const commentId = _.object(attributeManager.getAttributesOnPosition(rep.selStart[0], rep.selStart[1])).comment;
  return commentId;
};

exports.hasCommentOnSelection = function () {
  let hasComment;
  const attributeManager = this.documentAttributeManager;
  const rep = this.rep;
  const firstLineOfSelection = rep.selStart[0];
  const firstColumn = rep.selStart[1];
  const lastColumn = rep.selEnd[1];
  const lastLineOfSelection = rep.selEnd[0];
  const selectionOfMultipleLine = hasMultipleLineSelected(firstLineOfSelection, lastLineOfSelection);

  if (selectionOfMultipleLine) {
    hasComment = hasCommentOnMultipleLineSelection(firstLineOfSelection, lastLineOfSelection, rep, attributeManager);
  } else {
    hasComment = hasCommentOnLine(firstLineOfSelection, firstColumn, lastColumn, attributeManager);
  }
  return hasComment;
};

const hasCommentOnMultipleLineSelection = function (firstLineOfSelection, lastLineOfSelection, rep, attributeManager) {
  let foundLineWithComment = false;
  for (let line = firstLineOfSelection; line <= lastLineOfSelection && !foundLineWithComment; line++) {
    const firstColumn = getFirstColumnOfSelection(line, rep, firstLineOfSelection);
    const lastColumn = getLastColumnOfSelection(line, rep, lastLineOfSelection);
    const hasComment = hasCommentOnLine(line, firstColumn, lastColumn, attributeManager);
    if (hasComment) {
      foundLineWithComment = true;
    }
  }
  return foundLineWithComment;
};

const getFirstColumnOfSelection = function (line, rep, firstLineOfSelection) {
  return line !== firstLineOfSelection ? 0 : rep.selStart[1];
};

const getLastColumnOfSelection = function (line, rep, lastLineOfSelection) {
  let lastColumnOfSelection;
  if (line !== lastLineOfSelection) {
    lastColumnOfSelection = getLength(line, rep); // length of line
  } else {
    lastColumnOfSelection = rep.selEnd[1] - 1; // position of last character selected
  }
  return lastColumnOfSelection;
};

const hasCommentOnLine = function (lineNumber, firstColumn, lastColumn, attributeManager) {
  let foundCommentOnLine = false;
  for (let column = firstColumn; column <= lastColumn && !foundCommentOnLine; column++) {
    const commentId = _.object(attributeManager.getAttributesOnPosition(lineNumber, column)).comment;
    if (commentId !== undefined) {
      foundCommentOnLine = true;
    }
  }
  return foundCommentOnLine;
};

const hasMultipleLineSelected = function (firstLineOfSelection, lastLineOfSelection) {
  return firstLineOfSelection !== lastLineOfSelection;
};

const getLength = function (line, rep) {
  const nextLine = line + 1;
  const startLineOffset = rep.lines.offsetOfIndex(line);
  const endLineOffset = rep.lines.offsetOfIndex(nextLine);

  // lineLength without \n
  const lineLength = endLineOffset - startLineOffset - 1;

  return lineLength;
};
