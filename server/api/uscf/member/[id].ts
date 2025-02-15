import { parse } from 'node-html-parser'
import { USCFMemberRanking } from '~/types/uscf'
import { gatherElements, findElement } from '~/utils/elements'

export default defineEventHandler(async (event) => {
    const id = parseInt(getRouterParam(event, 'id') || '0')

    // Fetch the HTML page from the USCF website and parse it
    const data = await fetch('https://www.uschess.org/msa/MbrDtlMain.php?' + id)
        .then(response => response.text())
        .then((data) => {
            // remove <nobr> tags
            return data.replaceAll('<nobr>', '').replaceAll('</nobr>', '')
        })
        .then((data) => {
            return parse(data)
        })

    // Gather all the <tr> elements and put their children into a matrix
    const elements: string[][] = gatherElements(data)

    // important indexes
    const startOfRatings = elements.find(element => element.join(' ').includes('Current Published'))
    const lastRatedEvent = elements.find(element => element[0].includes('Last Rated Event'))

    // throw error if no start of ratings
    if (!startOfRatings || !lastRatedEvent) {
        return {
            success: false,
            error: 'No start of ratings found.'
        }
    }

    // ratings that will be published on the first of the following month
    // this just means the user has been to a rated tournament this month
    const hasFutureRatings = startOfRatings.join(' ').includes('Published Rating')
    const futureDate = hasFutureRatings ? startOfRatings[2].split(' ')[3] : null

    // handle ratings
    const ratings: Record<string, object> = {
        regular: {},
        quick: {},
        blitz: {},
        online_regular: {},
        online_quick: {},
        online_blitz: {}
    }
    for (let i = elements.indexOf(startOfRatings) + 1; i < elements.indexOf(lastRatedEvent); i++) {
        const ele = elements[i]
        const ratingType: string = ele[0].split(' ')[0].toLowerCase().replace('-', '_')
        const currentRating = ele[1] // also has a date and "based on x" games
        const futureRating = hasFutureRatings ? ele[2] : null

        ratings[ratingType] = {
            current: {
                elo: parseInt(currentRating.split(' ')[0]),
                games: currentRating.includes('Based on') ? parseInt(currentRating.split(' ')[3]) : undefined,
                floor: currentRating.includes('floor') ? parseInt(currentRating.split(' ')[3]) : undefined,
                date: currentRating.split('\n')[1]
            },
            future: futureRating ? {
                elo: parseInt(futureRating.split(' ')[0]),
                games: futureRating.includes('Based on') ? parseInt(futureRating.split(' ')[3]) : undefined,
                date: futureDate
            } : undefined
        }
    }

    // Handle last rated info using a complex regex
    const lastRatedInfo = lastRatedEvent[0].split(/(Last Rated Event: )(\d+)(.*)(Rated on )(\d+-\d+-\d+)/)
    const lastRatedEventInfo = {
        id: parseInt(lastRatedInfo[2]),
        name: lastRatedInfo[3].trim(),
        ratedOn: lastRatedInfo[5]
    }

    // handle rankings
    const rankings: Record<string, USCFMemberRanking | null> = {
        overall: null,
        gender: null,
        state: null
    }

    const rankingData: Record<string, string[] | undefined> = {
        overall: elements.find(element => element[0].includes('Overall Rank')),
        gender: elements.find(element => element[0].includes('ale Rank')),
        state: elements.find(element => element[0].includes('State Ranking ('))
    }

    // Only calculate rankings if they exist. They only do if the player has played in a tournament this year.
    const types = ['overall', 'gender', 'state']

    for (let i = 0; i < types.length; i++) {
        const rankData = rankingData[types[i]]

        if (!rankData) {
            continue
        }

        rankings[types[i]] = {
            rank: parseInt(rankData[1].split(' ')[0]),
            total: parseInt(rankData[1].split(' ')[3]),
            tied: rankData[1].includes('Tied'),
            percentile: parseFloat(rankData[2])
        }
    }

    // Return everything :)
    return {
        success: true,
        error: null,

        // real data here pls! :3
        member: {
            id: parseInt(elements[2][0].split(':')[0]),
            name: elements[2][0].split(': ')[1]
        },
        ratings,
        rankings,
        lastRatedEvent: lastRatedEventInfo || null,
        titles: findElement(elements, 'US Chess Titles Earned', false)?.split(', ') || [],
        state: findElement(elements, 'State'),
        gender: findElement(elements, 'Gender'),
        expiration: findElement(elements, 'Expiration Dt.'),
        fide: {
            id: findElement(elements, 'FIDE ID')?.replace('Latest FIDE Rating', ''),
            country: findElement(elements, 'FIDE Country'),
            titles: findElement(elements, 'FIDE Title(s)')?.split('&nbsp;').map(title => title.trim()).filter(title => title !== '') || []
        },
        lastChange: findElement(elements, 'Last Change Dt.')
    }
})
